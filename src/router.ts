import { now } from './time.js';

export type IntentSource = 'web' | 'mobile' | 'voice' | 'api';

export interface IntentPayload {
  intentId: string;
  rawText: string;
  parameters: Record<string, unknown>;
  source: IntentSource;
  submittedAt: number;
}

export type IntentCategory = 'transaction' | 'support' | 'lead' | 'scheduling' | 'unclassified';

/**
 * Hick's Law, reframed: decision time should scale with how many business
 * rules the backend evaluates, never with how many options a human is shown.
 * Choice presented to a user is a system failure signal, not a UX pattern —
 * so BusinessRule.test() runs against the payload, not against a menu the
 * visitor has to read and pick from.
 */
export interface BusinessRule {
  id: string;
  category: IntentCategory;
  /** Lower priority values are evaluated first. */
  priority: number;
  test: (payload: IntentPayload) => boolean;
}

export interface RoutingDecision {
  intentId: string;
  category: IntentCategory;
  matchedRuleId: string | null;
  confidence: number;
  decidedAt: number;
  decisionLatencyMs: number;
}

export interface WebhookResult {
  webhookId: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface WebhookTarget {
  id: string;
  url: string;
  dispatch: (decision: RoutingDecision, payload: IntentPayload) => Promise<void>;
}

export interface RoutingResult {
  decision: RoutingDecision;
  webhookResults: WebhookResult[];
}

type RouterEvent = 'decision' | 'resolved';
type RouterListener = (payload: unknown) => void;

/**
 * IntentRouter replaces the static, multi-step form with intent-first
 * routing: raw intent goes in, a deterministic category and a fan-out of
 * concurrent orchestration webhooks come out. This is the backend decision
 * engine that Hick's Law says a well-built system should own instead of the
 * interface.
 */
export class IntentRouter {
  private readonly rules: BusinessRule[] = [];
  private readonly webhooks: WebhookTarget[] = [];
  private readonly listeners = new Map<RouterEvent, Set<RouterListener>>();

  registerRule(rule: BusinessRule): void {
    this.rules.push(rule);
  }

  registerWebhook(target: WebhookTarget): void {
    this.webhooks.push(target);
  }

  on(event: RouterEvent, listener: RouterListener): () => void {
    const set = this.listeners.get(event) ?? new Set<RouterListener>();
    set.add(listener);
    this.listeners.set(event, set);
    return () => set.delete(listener);
  }

  private emit(event: RouterEvent, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }

  /**
   * Evaluates business rules deterministically (lowest priority first,
   * first match wins) and fires every registered webhook concurrently —
   * simulating the CRM/messaging/payment orchestration that a real
   * operational surface triggers the instant intent is categorized.
   */
  async route(payload: IntentPayload): Promise<RoutingResult> {
    const decisionStart = now();

    const sortedRules = [...this.rules].sort((a, b) => a.priority - b.priority);
    const matchedRule = sortedRules.find((rule) => rule.test(payload)) ?? null;

    const decision: RoutingDecision = {
      intentId: payload.intentId,
      category: matchedRule?.category ?? 'unclassified',
      matchedRuleId: matchedRule?.id ?? null,
      confidence: matchedRule ? 1 : 0,
      decidedAt: now(),
      decisionLatencyMs: now() - decisionStart,
    };

    this.emit('decision', decision);

    const webhookResults = await Promise.all(
      this.webhooks.map((target) => this.dispatchWebhook(target, decision, payload)),
    );

    const result: RoutingResult = { decision, webhookResults };
    this.emit('resolved', result);
    return result;
  }

  private async dispatchWebhook(
    target: WebhookTarget,
    decision: RoutingDecision,
    payload: IntentPayload,
  ): Promise<WebhookResult> {
    const start = now();
    try {
      await target.dispatch(decision, payload);
      return { webhookId: target.id, ok: true, latencyMs: now() - start };
    } catch (error) {
      return {
        webhookId: target.id,
        ok: false,
        latencyMs: now() - start,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Builds a mock enterprise webhook (CRM sync, payment ledger, scheduling
 * engine, etc.) that resolves after simulatedLatencyMs — enough to exercise
 * the router's concurrent fan-out without any real integration wired up yet.
 */
export function createMockWebhook(id: string, simulatedLatencyMs = 50, url = `mock://${id}`): WebhookTarget {
  return {
    id,
    url,
    dispatch: () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, simulatedLatencyMs);
      }),
  };
}
