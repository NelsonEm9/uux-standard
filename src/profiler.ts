import { DEFAULT_INTENT_DECAY_HALF_LIFE_MS, DOHERTY_THRESHOLD_MS, clamp, now } from './time.js';

export interface IntentTrace {
  intentId: string;
  intentWeight: number;
  startedAt: number;
  userWaitTime: number;
  systemDelay: number;
  waitStartedAt: number | null;
  delayStartedAt: number | null;
}

export interface EfficiencyScore {
  intentId: string;
  /** Raw score: decayed intent weight minus accumulated latency, in seconds. */
  score: number;
  /** score squashed into (0, 1) via logistic normalization, for dashboards/alerting. */
  normalizedScore: number;
  userWaitTime: number;
  systemDelay: number;
  totalLatencyMs: number;
  /** Multiplier applied to intentWeight to account for Intent Decay over elapsed time. */
  decayFactor: number;
  withinDohertyThreshold: boolean;
}

export interface ProfilerOptions {
  intentDecayHalfLifeMs?: number;
}

/**
 * UUXProfiler measures the two variables the UUX equation depends on:
 * Conversion = f(Intent) - (User Wait Time + System Delay)
 *
 * Every millisecond a system makes a human wait, or spends resolving a
 * request behind the scenes, is friction subtracted directly from
 * conversion. Traditional UX profiling instruments only render performance;
 * this profiler treats user-perceived wait and backend system delay as the
 * two first-class latency laws that determine whether intent survives long
 * enough to convert.
 */
export class UUXProfiler {
  private readonly traces = new Map<string, IntentTrace>();
  private readonly intentDecayHalfLifeMs: number;

  constructor(options: ProfilerOptions = {}) {
    this.intentDecayHalfLifeMs = options.intentDecayHalfLifeMs ?? DEFAULT_INTENT_DECAY_HALF_LIFE_MS;
  }

  /** Opens a trace for a captured intent. intentWeight is the business value of resolving it (default 1). */
  beginIntent(intentId: string, intentWeight = 1): void {
    this.traces.set(intentId, {
      intentId,
      intentWeight,
      startedAt: now(),
      userWaitTime: 0,
      systemDelay: 0,
      waitStartedAt: null,
      delayStartedAt: null,
    });
  }

  /** Marks the start of a span where the human is waiting on the interface (loading spinners, blocked input). */
  beginUserWait(intentId: string): void {
    const trace = this.getTrace(intentId);
    trace.waitStartedAt = now();
  }

  endUserWait(intentId: string): void {
    const trace = this.getTrace(intentId);
    if (trace.waitStartedAt !== null) {
      trace.userWaitTime += now() - trace.waitStartedAt;
      trace.waitStartedAt = null;
    }
  }

  /** Marks the start of a span where the backend is resolving the request (API calls, DB writes, webhook fan-out). */
  beginSystemDelay(intentId: string): void {
    const trace = this.getTrace(intentId);
    trace.delayStartedAt = now();
  }

  endSystemDelay(intentId: string): void {
    const trace = this.getTrace(intentId);
    if (trace.delayStartedAt !== null) {
      trace.systemDelay += now() - trace.delayStartedAt;
      trace.delayStartedAt = null;
    }
  }

  /**
   * Closes the trace and computes the efficiency score. Conversion friction
   * is not just latency — it is latency relative to how much intent has
   * already decayed while the user waited, so decay is applied to
   * intentWeight before the UUX equation is evaluated.
   */
  resolve(intentId: string): EfficiencyScore {
    const trace = this.getTrace(intentId);
    this.endUserWait(intentId);
    this.endSystemDelay(intentId);

    const elapsedMs = now() - trace.startedAt;
    const decayFactor = Math.pow(0.5, elapsedMs / this.intentDecayHalfLifeMs);
    const effectiveIntentWeight = trace.intentWeight * decayFactor;

    const totalLatencyMs = trace.userWaitTime + trace.systemDelay;
    const totalLatencySeconds = totalLatencyMs / 1000;
    const score = effectiveIntentWeight - totalLatencySeconds;

    // Logistic squash keeps wildly varying raw scores comparable across
    // intents of different weight without ever dividing by zero.
    const normalizedScore = 1 / (1 + Math.exp(-score));

    this.traces.delete(intentId);

    return {
      intentId,
      score,
      normalizedScore: clamp(normalizedScore, 0, 1),
      userWaitTime: trace.userWaitTime,
      systemDelay: trace.systemDelay,
      totalLatencyMs,
      decayFactor,
      withinDohertyThreshold: totalLatencyMs <= DOHERTY_THRESHOLD_MS,
    };
  }

  private getTrace(intentId: string): IntentTrace {
    const trace = this.traces.get(intentId);
    if (!trace) {
      throw new Error(`UUXProfiler: no open trace for intentId "${intentId}". Call beginIntent() first.`);
    }
    return trace;
  }
}
