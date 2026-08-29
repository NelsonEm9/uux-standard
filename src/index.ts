import { UUXProfiler, type EfficiencyScore } from './profiler.js';
import { IntentRouter, type IntentPayload, type RoutingResult } from './router.js';
import { ComplexityAbsorberMiddleware, type OptimisticResponse } from './middleware.js';
import { DOHERTY_THRESHOLD_MS } from './time.js';

export * from './profiler.js';
export * from './router.js';
export * from './middleware.js';
export { DOHERTY_THRESHOLD_MS, DEFAULT_INTENT_DECAY_HALF_LIFE_MS } from './time.js';

export interface UUXConfig {
  /** Backend logic and routing are designed before any screen is laid out. */
  operationsFirst: boolean;
  /** Mobile is the contextual expression layer, not the architectural starting point. */
  mobileSecond: boolean;
  /** Intent capture takes precedence over interface navigation when both compete for priority. */
  intentPrioritization: boolean;
  /** Latency budget, in ms, that acknowledgment and routing decisions are held to. */
  maxLatencyThresholdMs: number;
}

export const DEFAULT_UUX_CONFIG: UUXConfig = {
  operationsFirst: true,
  mobileSecond: true,
  intentPrioritization: true,
  maxLatencyThresholdMs: DOHERTY_THRESHOLD_MS,
};

function validateConfig(config: UUXConfig): void {
  const booleanFields: Array<keyof UUXConfig> = ['operationsFirst', 'mobileSecond', 'intentPrioritization'];
  for (const field of booleanFields) {
    if (typeof config[field] !== 'boolean') {
      throw new TypeError(`UUXFramework: config.${field} must be a boolean.`);
    }
  }
  if (
    typeof config.maxLatencyThresholdMs !== 'number' ||
    !Number.isFinite(config.maxLatencyThresholdMs) ||
    config.maxLatencyThresholdMs <= 0
  ) {
    throw new TypeError('UUXFramework: config.maxLatencyThresholdMs must be a positive finite number.');
  }
}

export interface ResolvedIntent {
  acknowledgement: OptimisticResponse<IntentPayload>;
  routing: RoutingResult;
  score: EfficiencyScore;
}

/**
 * UUXFramework wires the three primitives of the UUX equation into one
 * instance: the profiler measures Conversion = f(Intent) - (User Wait Time +
 * System Delay), the middleware absorbs complexity and acknowledges intent
 * within the configured latency budget, and the router categorizes intent
 * and fires enterprise orchestration concurrently.
 */
export class UUXFramework {
  readonly config: UUXConfig;
  readonly profiler: UUXProfiler;
  readonly router: IntentRouter;
  readonly middleware: ComplexityAbsorberMiddleware;

  constructor(config: Partial<UUXConfig> = {}) {
    const merged: UUXConfig = { ...DEFAULT_UUX_CONFIG, ...config };
    validateConfig(merged);

    this.config = merged;
    this.profiler = new UUXProfiler();
    this.router = new IntentRouter();
    this.middleware = new ComplexityAbsorberMiddleware();
  }

  /**
   * Runs one full Intent -> Decision -> Action -> Resolution pass: profiled
   * end to end, acknowledged optimistically, routed and dispatched to every
   * registered webhook.
   */
  async resolveIntent(payload: IntentPayload, intentWeight = 1): Promise<ResolvedIntent> {
    this.profiler.beginIntent(payload.intentId, intentWeight);

    this.profiler.beginSystemDelay(payload.intentId);
    const acknowledgement = await this.middleware.acknowledge(payload.intentId, payload);
    const routing = await this.router.route(payload);
    this.profiler.endSystemDelay(payload.intentId);

    const score = this.profiler.resolve(payload.intentId);

    return { acknowledgement, routing, score };
  }
}
