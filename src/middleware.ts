import { delay, now } from './time.js';

export type RawParameters = Record<string, unknown>;
export type NormalizedParameters = Record<string, string | number | boolean | null>;

export interface OptimisticResponse<T> {
  status: 'accepted';
  intentId: string;
  acknowledgedAt: number;
  acknowledgmentLatencyMs: number;
  payload: T;
}

export interface RetryableOperation<T> {
  execute: () => Promise<T>;
  maxAttempts?: number;
  backoffMs?: number;
}

export interface RetryOutcome<T> {
  succeeded: boolean;
  attempts: number;
  result?: T;
  lastError?: string;
}

export const DEFAULT_MAX_RETRY_ATTEMPTS = 3;
export const DEFAULT_RETRY_BACKOFF_MS = 250;

/**
 * Every operation has an irreducible amount of complexity (Tesler's Law) —
 * this middleware exists so that complexity is absorbed at the
 * infrastructure layer instead of being dumped on the user as extra form
 * fields, or on staff as manual re-keying. Nothing upstream of this class
 * should ever see a raw, un-normalized payload or a failed first attempt.
 */
export class ComplexityAbsorberMiddleware {
  /**
   * Miller's Law, reframed: a human shouldn't have to hold 7±2 raw fields in
   * working memory to make sense of a payload. Collapse arbitrary input into
   * a flat, primitive-only record so downstream consumers get one
   * unambiguous shape instead of raw, unbounded structure.
   */
  normalize(raw: RawParameters): NormalizedParameters {
    const normalized: NormalizedParameters = {};

    for (const [key, value] of Object.entries(raw)) {
      const trimmedKey = key.trim();
      if (trimmedKey.length === 0 || value === undefined || typeof value === 'function') {
        continue;
      }

      if (value === null) {
        normalized[trimmedKey] = null;
      } else if (typeof value === 'string') {
        normalized[trimmedKey] = value.trim();
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        normalized[trimmedKey] = value;
      } else if (Array.isArray(value)) {
        normalized[trimmedKey] = value.map((item) => String(item)).join(',');
      } else {
        normalized[trimmedKey] = JSON.stringify(value);
      }
    }

    return normalized;
  }

  /**
   * Returns an optimistic acknowledgement synchronously fast, well inside
   * the 400ms Doherty Threshold, so the user perceives instantaneous system
   * response regardless of how long true backend resolution takes.
   */
  async acknowledge<T>(intentId: string, payload: T): Promise<OptimisticResponse<T>> {
    const start = now();
    const acknowledgedAt = now();
    const acknowledgmentLatencyMs = acknowledgedAt - start;

    return { status: 'accepted', intentId, acknowledgedAt, acknowledgmentLatencyMs, payload };
  }

  /**
   * Absorbs transient failures silently: retries happen behind the
   * acknowledged optimistic response, never surfaced to the user as a
   * spinner, an error toast, or a re-submitted form.
   */
  async absorbWithRetry<T>(operation: RetryableOperation<T>): Promise<RetryOutcome<T>> {
    const maxAttempts = operation.maxAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS;
    const backoffMs = operation.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await operation.execute();
        return { succeeded: true, attempts: attempt, result };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts) {
          await delay(backoffMs * attempt);
        }
      }
    }

    return { succeeded: false, attempts: maxAttempts, lastError };
  }
}
