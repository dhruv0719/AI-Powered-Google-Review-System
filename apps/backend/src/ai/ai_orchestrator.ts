import crypto from 'node:crypto';
import { getEnv } from '../config/env.js';
import {
  DraftGenerationRequestInput,
  DraftGenerationResponseDTO,
  AiAssistantConstants,
} from '@review-system/shared';
import { MeaningfulInputValidator } from './input_validator.js';
import { PiiRedactor } from './pii_redactor.js';
import { PromptEngine } from './prompt_engine.js';
import { OutputValidationPipeline } from './output_validator.js';
import { AiProvider } from './adapters/ai_provider.interface.js';
import { MockAiProvider } from './adapters/mock_provider.js';
import { computePayloadFingerprint } from './fingerprint.js';
import {
  canonicalizeLanguage,
  checkSessionAndReplay,
  reserveSessionLease,
  releaseSessionLease,
  settleDraftGeneration,
  FeatureDisabledError,
  AiValidationError,
  OutputGuardrailError,
} from './session_guard.js';

export interface AiOrchestratorOptions {
  provider?: AiProvider;
  timeoutMs?: number;
}

export class AiOrchestrator {
  private readonly defaultProvider: AiProvider;

  constructor(defaultProvider?: AiProvider) {
    this.defaultProvider = defaultProvider ?? new MockAiProvider();
  }

  /**
   * Orchestrates the complete review draft generation pipeline:
   * 1. Feature flag enforcement (ENABLE_AI_ASSISTANT)
   * 2. Language canonicalization
   * 3. Deterministic payload fingerprinting
   * 4. Session & Replay check (idempotency key: session_id + client_draft_id)
   * 5. Semantic input validation (MeaningfulInputValidator - purely in-memory)
   * 6. PII redaction (PiiRedactor)
   * 7. Phase 1: Atomic lease reservation (30s lease via clock_timestamp)
   * 8. External provider execution with 15s AbortSignal timeout
   * 9. Output guardrail validation (OutputGuardrailPipeline)
   * 10. Phase 2: Atomic settlement transaction (Hierarchy T -> L -> C -> S)
   */
  public async generateDraft(
    db: any,
    sessionId: string,
    input: DraftGenerationRequestInput,
    options?: AiOrchestratorOptions
  ): Promise<DraftGenerationResponseDTO> {
    // 1. Feature flag enforcement
    const env = getEnv();
    if (!env.ENABLE_AI_ASSISTANT) {
      throw new FeatureDisabledError();
    }

    // 2. Language canonicalization
    const canonicalLanguage = canonicalizeLanguage(input.language);

    // 3. Compute deterministic payload fingerprint
    const payloadFingerprint = computePayloadFingerprint({
      feedback: input.feedback,
      rating: input.rating,
      serviceIds: input.serviceIds,
      language: input.language,
    });

    // 4. Session validity and idempotency replay check (single indexed read, no locks)
    const replayCheck = await checkSessionAndReplay(
      db,
      sessionId,
      input.clientDraftId,
      payloadFingerprint
    );

    if (replayCheck.isReplay) {
      return {
        status: 'generated',
        draft: replayCheck.draft!,
        generationsRemaining: replayCheck.generationsRemaining,
        isReplay: true,
      };
    }

    const sessionContext = replayCheck.sessionContext!;

    // 5. Semantic input validation (in-memory BEFORE lease reservation)
    const validationResult = MeaningfulInputValidator.validate(
      input.feedback,
      canonicalLanguage
    );

    if (!validationResult.isValid) {
      if (validationResult.reasonCode === 'INPUT_TOO_LONG') {
        throw new AiValidationError(validationResult.message);
      }

      // Semantic failures (too short, low diversity, spam, mash) consume 0 quota and 0 leases
      return {
        status: 'insufficient_context',
        draft: null,
        generationsRemaining: sessionContext.generationsRemaining,
        isReplay: false,
      };
    }

    // 6. PII Redaction
    const redactionResult = PiiRedactor.redact(input.feedback);
    const sanitizedFeedback = redactionResult.sanitizedText;

    // 7. Phase 1: Atomic Lease Reservation (30 seconds via clock_timestamp)
    const lockToken = crypto.randomUUID();
    const reservation = await reserveSessionLease(db, sessionId, lockToken);
    const expectedQuota = reservation.generationsRemaining;

    // 8. Provider Execution & Output Guardrails (Protected by lease)
    let draftText: string;
    const provider = options?.provider ?? this.defaultProvider;
    const timeoutMs =
      options?.timeoutMs ??
      (AiAssistantConstants.LOCK_LEASE_DURATION_SECONDS / 2) * 1000; // 15_000 ms

    try {
      const promptMessages = PromptEngine.buildPromptMessages(
        sanitizedFeedback,
        canonicalLanguage
      );

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let aiResult;
      try {
        aiResult = await provider.generateDraft({
          promptMessages,
          language: canonicalLanguage,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (aiResult.status === 'insufficient_context' || !aiResult.draft) {
        // Provider indicated insufficient context; release lease and return live quota
        const liveQuota = await releaseSessionLease(db, sessionId, lockToken);
        return {
          status: 'insufficient_context',
          draft: null,
          generationsRemaining: liveQuota,
          isReplay: false,
        };
      }

      // 9. Output Guardrail Validation
      const guardrailResult = OutputValidationPipeline.validate(
        aiResult.draft,
        sanitizedFeedback
      );

      if (!guardrailResult.isValid) {
        throw new OutputGuardrailError(
          guardrailResult.message,
          guardrailResult.reasonCode
        );
      }

      draftText = guardrailResult.draft;
    } catch (err) {
      // Release lease with dual-predicate fencing upon failure, timeout, or guardrail rejection
      await releaseSessionLease(db, sessionId, lockToken).catch(() => {});
      throw err;
    }

    // 10. Phase 2: Atomic Settlement Transaction (Hierarchy T -> L -> C -> S)
    try {
      const settlement = await settleDraftGeneration(db, {
        sessionId,
        tenantId: sessionContext.tenantId,
        locationId: sessionContext.locationId,
        campaignId: sessionContext.campaignId,
        lockToken,
        expectedQuota,
        clientDraftId: input.clientDraftId,
        payloadFingerprint,
        draftText,
      });

      return {
        status: 'generated',
        draft: draftText,
        generationsRemaining: settlement.generationsRemaining,
        isReplay: false,
      };
    } catch (settleErr) {
      // Release lease with dual-predicate fencing upon transaction abort
      await releaseSessionLease(db, sessionId, lockToken).catch(() => {});
      throw settleErr;
    }
  }
}
