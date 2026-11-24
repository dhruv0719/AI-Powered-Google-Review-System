/**
 * Opt-In Synthetic Live Smoke Test for Groq AI Provider
 *
 * Usage:
 *   GROQ_API_KEY=<your-key> npx tsx apps/backend/scripts/smoke-groq-provider.ts
 *
 * Requirements:
 * - Strictly opt-in: if GROQ_API_KEY is not provided, exits cleanly without error.
 * - Uses strictly synthetic feedback; never queries database or uses customer PII.
 * - Validates generated draft against OutputValidationPipeline.
 * - Never prints or leaks raw API keys or key fragments.
 */
import { GroqAiProvider } from '../src/ai/adapters/groq_provider.js';
import { PromptEngine } from '../src/ai/prompt_engine.js';
import { OutputValidationPipeline } from '../src/ai/output_validator.js';

async function runSmokeTest(): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    console.log('\n[SMOKE TEST SKIPPED] No GROQ_API_KEY environment variable provided.');
    console.log('To run live smoke test against Groq:');
    console.log('  GROQ_API_KEY=<your-key> npx tsx apps/backend/scripts/smoke-groq-provider.ts\n');
    process.exit(0);
  }

  const model = process.env.AI_MODEL?.trim() || 'openai/gpt-oss-20b';
  console.log('\n========================================');
  console.log('  Groq AI Provider Live Smoke Test');
  console.log('========================================');
  console.log(`Provider:  groq`);
  console.log(`Model:     ${model}`);
  console.log(`API Key:   [CONFIGURED]`);

  // Strictly synthetic feedback text (routine local business review)
  const syntheticFeedback =
    'Visited today for a routine service. Staff explained the work clearly and finished on time.';

  console.log(`\nInput Feedback: "${syntheticFeedback}"`);
  console.log('Building prompt messages...');

  const promptMessages = PromptEngine.buildPromptMessages(syntheticFeedback, 'en');
  const provider = new GroqAiProvider({ apiKey, model });

  console.log('Calling Groq Chat Completions API with structured output schema...');
  const startTime = Date.now();

  try {
    const result = await provider.generateDraft({
      promptMessages,
      language: 'en',
    });

    const durationMs = Date.now() - startTime;
    console.log(`Response received in ${durationMs}ms:`);
    console.log(`  Status: ${result.status}`);
    console.log(`  Model:  ${result.model}`);
    if (result.tokenUsage) {
      console.log(
        `  Usage:  ${result.tokenUsage.promptTokens} prompt + ${result.tokenUsage.completionTokens} completion = ${result.tokenUsage.totalTokens} total tokens`
      );
    }

    if (result.status === 'insufficient_context' || !result.draft) {
      console.log('  Notice: Provider returned insufficient_context.');
    } else {
      console.log(`  Generated Draft: "${result.draft}"`);

      // Run guardrail validation
      console.log('\nRunning OutputValidationPipeline...');
      const guardrailResult = OutputValidationPipeline.validate(result.draft, syntheticFeedback);

      if (!guardrailResult.isValid) {
        console.error(`FAILED: Guardrail violation: ${guardrailResult.reasonCode} - ${guardrailResult.message}`);
        process.exit(1);
      }

      console.log(`Guardrail PASS (Graphemes: ${guardrailResult.graphemeCount})`);
    }

    console.log('\n Smoke test PASSED successfully!\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n FAILED: Groq provider call failed:');
    console.error(`  Error Code: ${error?.code || 'UNKNOWN'}`);
    console.error(`  Error Name: ${error?.name || 'Error'}`);
    console.error(`  Message:    ${error?.message || String(error)}`);
    process.exit(1);
  }
}

runSmokeTest();
