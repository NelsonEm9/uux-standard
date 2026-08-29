/**
 * Shared timing primitives for @uux-design/core.
 *
 * The Doherty Threshold (Doherty & Jorgensen, 1979) is the empirical finding
 * that system response times under ~400ms keep a human operator's attention
 * and productivity uninterrupted. Every latency-sensitive module in this
 * package measures against this constant instead of an arbitrary number.
 */

export const DOHERTY_THRESHOLD_MS = 400;

/**
 * Intent decays exponentially the longer resolution takes — the treatise's
 * "Intent Decay" law. One minute is the default half-life: after 60s of
 * unresolved latency, half of the original intent's weight is considered lost.
 */
export const DEFAULT_INTENT_DECAY_HALF_LIFE_MS = 60_000;

/** performance.now() where available, Date.now() polyfill everywhere else. */
export function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
