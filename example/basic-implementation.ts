import { UUXFramework, createMockWebhook, type IntentPayload } from '../src/index.js';

/**
 * Turns a raw intent string typed by a user into a structured IntentPayload.
 * In production this is where an LLM classifier or a simple keyword/regex
 * pass would extract parameters; here it is a minimal deterministic parser
 * so the example has no external dependencies.
 */
function parseRawIntent(rawText: string): IntentPayload {
  const lower = rawText.toLowerCase();
  const urgent = lower.includes('urgent') || lower.includes('asap') || lower.includes('emergency');

  return {
    intentId: `intent_${Date.now()}`,
    rawText,
    parameters: { urgent },
    source: 'web',
    submittedAt: Date.now(),
  };
}

async function main(): Promise<void> {
  const framework = new UUXFramework({
    operationsFirst: true,
    mobileSecond: true,
    intentPrioritization: true,
  });

  framework.router.registerRule({
    id: 'urgent-support',
    category: 'support',
    priority: 0,
    test: (payload) => payload.parameters.urgent === true,
  });

  framework.router.registerRule({
    id: 'default-lead',
    category: 'lead',
    priority: 10,
    test: () => true,
  });

  framework.router.registerWebhook(createMockWebhook('crm-sync', 40));
  framework.router.registerWebhook(createMockWebhook('messaging-notify', 25));
  framework.router.registerWebhook(createMockWebhook('scheduling-engine', 60));

  const rawIntent = 'Need an emergency repair quote ASAP, my kitchen sink is leaking.';
  const payload = parseRawIntent(rawIntent);

  console.log('--- UUX Framework: Basic Implementation ---');
  console.log(`Raw intent: "${rawIntent}"`);

  const resolved = await framework.resolveIntent(payload, /* intentWeight */ 5);
  const { acknowledgement, routing, score } = resolved;

  console.log('\n[Resolution] Category:', routing.decision.category);
  console.log('[Resolution] Matched rule:', routing.decision.matchedRuleId);
  console.log(
    '[Resolution] Webhooks fired:',
    routing.webhookResults.map((w) => `${w.webhookId} (${w.ok ? 'ok' : 'failed'}, ${w.latencyMs.toFixed(1)}ms)`),
  );
  console.log('[Resolution] Optimistic ack latency (ms):', acknowledgement.acknowledgmentLatencyMs.toFixed(3));

  console.log('\n--- UUX Equation ---');
  console.log('Conversion = f(Intent) - (User Wait Time + System Delay)');
  console.log(`  Decayed intent weight (f(Intent)): ${(score.decayFactor * 5).toFixed(4)}`);
  console.log(`  User Wait Time (ms): ${score.userWaitTime.toFixed(3)}`);
  console.log(`  System Delay (ms): ${score.systemDelay.toFixed(3)}`);
  console.log(`  Raw efficiency score: ${score.score.toFixed(4)}`);
  console.log(`  Normalized score (0-1): ${score.normalizedScore.toFixed(4)}`);
  console.log(`  Within Doherty Threshold (<=400ms): ${score.withinDohertyThreshold}`);

  console.log('\n--- Profiler Loop (10 simulated intents) ---');
  for (let i = 0; i < 10; i++) {
    const loopPayload = parseRawIntent(`Simulated intent #${i}`);
    framework.profiler.beginIntent(loopPayload.intentId, 1);
    framework.profiler.beginSystemDelay(loopPayload.intentId);
    await framework.middleware.acknowledge(loopPayload.intentId, loopPayload);
    framework.profiler.endSystemDelay(loopPayload.intentId);
    const loopScore = framework.profiler.resolve(loopPayload.intentId);
    console.log(`  #${i}: normalizedScore=${loopScore.normalizedScore.toFixed(4)} withinDoherty=${loopScore.withinDohertyThreshold}`);
  }
}

main().catch((error) => {
  console.error('UUX example failed:', error);
  process.exitCode = 1;
});
