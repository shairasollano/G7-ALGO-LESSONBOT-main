/**
 * Provider factory and fallback orchestration.
 *
 * The curated fallback answers when the AI provider is disabled, not
 * configured, or fails. Hard rules that govern the interaction with streaming:
 *
 *   1. If the AI provider already emitted a text delta before failing, we do
 *      NOT silently swap in curated content — the student has seen AI text,
 *      and prepending/appending pre-written paragraphs would duplicate or
 *      contradict it. The failure is thrown and surfaces as a stream error.
 *   2. When the AI provider fails before any delta was emitted, the curated
 *      fallback answers and the response mode honestly reports
 *      "curated_fallback".
 *
 * When an AI provider is enabled, each turn is ORCHESTRATED (see
 * orchestrator.ts): the model proposes a validated plan (intent, effective
 * topic, optional allowlisted tool), validated tool arguments run the
 * deterministic solvers, and only then does the model compose the explanation
 * around the verified result. Generative providers: xKiro (OpenAI-compatible,
 * default when configured) and Gemini (compliance-gated).
 */
import { config, isGeminiEnabled, isXKiroEnabled } from "../../config.js";
import { CuratedFallbackProvider } from "./curated-fallback.js";
import {
  assessScope,
  findSecretLeaks,
  findRuntimeClaims,
  numericCorrectionBlocks,
  offTopicReply,
  runtimeClaimNotice,
  verifyNumericClaims,
} from "./guardrails.js";
import {
  clearProviderCooldown,
  isProviderCoolingDown,
  providerCooldown,
  reasonForError,
  recordProviderCooldown,
  recordsCooldown,
} from "./provider-cooldown.js";
import type { ChatBlock, SolverResult } from "../../../../shared/contract.js";
import type { TutorContext, TutorProvider, TutorReply, TutorStreamHandlers, TutorUsage } from "./types.js";
import { isTopicId, detectTopicId } from "./topic-detection.js";
import type { TutorPlan } from "./orchestrator.js";

export { clearProviderCooldown };

/** The active generative provider, if any. xKiro takes precedence when both
 * are configured; the Gemini audience-compliance gate stays Gemini-specific. */
function activeAiProvider(): "gemini" | "xkiro" | null {
  return isXKiroEnabled() ? "xkiro" : isGeminiEnabled() ? "gemini" : null;
}

/** Load the active provider's planner/composer entry points. */
async function loadActiveAiProvider(key: "gemini" | "xkiro"): Promise<{
  planWithRetry: (context: TutorContext, signal?: AbortSignal) => Promise<{ plan: TutorPlan; usage?: TutorUsage }>;
  streamReply: (
    context: TutorContext,
    streaming?: TutorStreamHandlers,
    orchestration?: { plan: TutorPlan; computation?: SolverResult; usedCuratedInput?: boolean },
  ) => Promise<{ reply: { blocks: ChatBlock[]; mode: "ai"; topicId?: string }; usage?: TutorUsage }>;
}> {
  if (key === "gemini") {
    const m = await import("./gemini-provider.js");
    return { planWithRetry: m.planWithRetry, streamReply: m.streamGeminiReply };
  }
  const m = await import("./xkiro-provider.js");
  return { planWithRetry: m.planWithRetry, streamReply: m.streamReply };
}

/** Backward-compatible alias for the provider factory. */
export async function createProvider(): Promise<TutorProvider> {
  if (isXKiroEnabled()) {
    try {
      const { XKiroTutorProvider } = await import("./xkiro-provider.js");
      return new XKiroTutorProvider();
    } catch {
      return new CuratedFallbackProvider();
    }
  }
  if (isGeminiEnabled()) {
    try {
      const { GeminiTutorProvider } = await import("./gemini-provider.js");
      return new GeminiTutorProvider();
    } catch {
      return new CuratedFallbackProvider();
    }
  }
  return new CuratedFallbackProvider();
}

/** Backward-compatible alias for the provider factory. */
export async function getProvider(): Promise<TutorProvider> {
  return createProvider();
}

export function providerStatus(): { provider: string; enabled: boolean } {
  const active = activeAiProvider();
  return {
    provider: active ?? config.ai.provider,
    enabled: active !== null,
  };
}

/**
 * Bound one provider call by the configured AI timeout. Exported so the quiz
 * generator reuses the SAME budget rather than inventing a second one.
 */
export function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error("AI request timed out"), { name: "TimeoutError" })),
      config.ai.timeoutMs,
    );
  });
  // Observe both settle paths so clearTimeout always runs and the derived
  // promise never produces an unhandled rejection of its own.
  const cleanup = () => clearTimeout(timer);
  promise.then(cleanup, cleanup);
  return Promise.race([promise, timeoutPromise]);
}

function runCuratedFallback(context: TutorContext, streaming?: TutorStreamHandlers): Promise<TutorReply> {
  const fallback = new CuratedFallbackProvider();
  return fallback.generateReply(context, streaming);
}

export interface StreamOutcome {
  reply: TutorReply;
  /** True when at least one text delta was emitted before completion. */
  streamedDeltas: boolean;
  /** Trustworthy provider usage metadata, when the provider reports it. */
  usage?: TutorUsage;
  /** Verified solver output for this turn, when the plan requested a tool. */
  computation?: SolverResult;
  /** The topic that actually governed this response (may differ from selection). */
  effectiveTopicId: string;
  /** The validated plan when the AI provider drove the turn. */
  plan?: import("./orchestrator.js").TutorPlan;
  /**
   * Sanitized, user-presentable reason when an enabled AI provider failed
   * BEFORE its first text delta and the curated fallback answered instead.
   * Undefined whenever the AI provider produced the reply.
   */
  fallbackReason?: string;
  /**
   * Set when a guardrail decided the turn instead of the provider (currently:
   * an off-topic request answered with a deterministic redirect).
   */
  guardrail?: { kind: "off_topic"; evidence: string[] };
}

/**
 * Post-generation guardrails (C and D): screen the assembled reply for
 * credential material, and check every labelled number the model stated about
 * a verified computation against the solver's authoritative result.
 *
 * A leaked credential is a hard failure — the reply is replaced by the curated
 * fallback rather than forwarded. A numeric disagreement is a soft failure:
 * the model's prose stays visible and an authoritative correction block is
 * appended, because silently editing streamed text would leave the student
 * with a half-true answer and no explanation.
 */
function applyReplyGuardrails<T extends { blocks: import("../../../../shared/contract.js").ChatBlock[] }>(
  reply: T,
  computation: SolverResult | undefined,
): { reply: T; appended: import("../../../../shared/contract.js").ChatBlock[]; leaked: string[] } {
  const prose = reply.blocks
    .filter((b): b is { type: "text"; markdown: string } => b.type === "text")
    .map((b) => b.markdown)
    .join("\n\n");
  const leaked = findSecretLeaks(prose);
  if (leaked.length > 0) return { reply, appended: [], leaked };

  const appended: import("../../../../shared/contract.js").ChatBlock[] = [];
  if (computation) {
    appended.push(...numericCorrectionBlocks(verifyNumericClaims(prose, computation)));
  }
  appended.push(...runtimeClaimNotice(findRuntimeClaims(prose)));
  return { reply, appended, leaked: [] };
}

/**
 * Map a provider failure to a fixed, user-presentable reason. Never forwards
 * raw error text (which could embed request details) — the category, class
 * name, and HTTP status from the SDK are enough. Single source: the cooldown
 * module's reasonForError (kept as an alias for existing callers/tests).
 */
export function sanitizeProviderError(err: unknown, providerKey?: "gemini" | "xkiro"): string {
  return reasonForError(err, providerKey);
}

/**
 * Streaming generation with automatic fallback. onDelta receives each newly
 * generated chunk exactly once, as the provider produces it — never cumulative
 * snapshots. The completion path does NOT re-emit the assembled text.
 */
export async function streamWithFallback(
  context: TutorContext,
  streaming?: TutorStreamHandlers,
): Promise<StreamOutcome> {
  // --- Guardrail A: educational scope, decided before any provider call. ---
  // A request outside algorithms/complexity never spends a provider request
  // and never risks a model improvising an answer outside its competence.
  const scope = assessScope(context.message);
  if (scope.verdict === "off_topic") {
    const redirect = offTopicReply(context.topicId ?? undefined);
    const effectiveTopicId = detectTopicId(context.message, context.topicId);
    streaming?.onResolved?.({ effectiveTopicId });
    return {
      reply: { blocks: redirect.blocks, mode: "curated_fallback", topicId: effectiveTopicId },
      streamedDeltas: false,
      effectiveTopicId,
      guardrail: { kind: "off_topic", evidence: scope.evidence },
    };
  }

  let emitted = false;
  const wrapped: TutorStreamHandlers = {
    ...streaming,
    onDelta: (text) => {
      emitted = true;
      streaming?.onDelta?.(text);
    },
  };

  const aiProviderKey = activeAiProvider();
  if (aiProviderKey) {
    // A confirmed rate limit was recorded for this provider: do not spend
    // another request on it until the cooldown expires. The curated fallback
    // answers and the response honestly reports the recorded restriction
    // (temporary rate limit, daily quota, or non-retryable access issue).
    if (isProviderCoolingDown(aiProviderKey)) {
      const cooldown = providerCooldown(aiProviderKey);
      const fallbackReason = cooldown?.reason ?? "AI rate limit reached";
      console.error(
        JSON.stringify({
          event: "ai_fallback_to_curated",
          provider: aiProviderKey,
          reason: fallbackReason,
          cooldownActive: true,
          cooldownRemainingMs: cooldown ? cooldown.until - Date.now() : null,
          ...(cooldown?.quotaMetric ? { quotaMetric: cooldown.quotaMetric } : {}),
          ...(cooldown?.retryDelayMs ? { retryDelayMs: cooldown.retryDelayMs } : {}),
          emittedDeltas: emitted,
        }),
      );
      const curated = await runCuratedFallback(context, wrapped);
      const effectiveTopicId = curated.topicId ?? detectTopicId(context.message, context.topicId);
      streaming?.onResolved?.({ effectiveTopicId });
      return {
        reply: { ...curated, mode: "curated_fallback" },
        streamedDeltas: false,
        effectiveTopicId,
        fallbackReason,
      };
    }
    try {
      const ai = await loadActiveAiProvider(aiProviderKey);
      const { executePlanTool } = await import("./orchestrator.js");

      // A. Conversation understanding: validated plan. Planning failure must
      // not kill the answer — degrade to a planless direct compose instead.
      let planning: Awaited<ReturnType<typeof ai.planWithRetry>> | undefined;
      let planError: unknown;
      try {
        planning = await withTimeout(ai.planWithRetry(context, streaming?.signal));
      } catch (err) {
        if (streaming?.signal?.aborted) throw err;
        planError = err;
        planning = undefined;
      }
      // A confirmed 429 on the planner means the composer would hit the same
      // rate limit — skip it entirely instead of spending a third request on a
      // known-limited quota bucket. The same applies to non-retryable
      // restrictions (auth/tier/permission), which would fail identically.
      // The outer catch records the cooldown and serves the curated fallback.
      if (recordsCooldown(planError)) {
        throw planError;
      }
      const effectiveTopicId = planning && isTopicId(planning.plan.topicId)
        ? (planning.plan.topicId as string)
        : detectTopicId(context.message, context.topicId);
      streaming?.onResolved?.({ effectiveTopicId });

      // B. Verified computation (only with allowlisted, validated arguments).
      const executed = planning ? executePlanTool(planning.plan) : undefined;
      const computation = executed?.computation;

      // C. Explanation, streaming, aware of the verified result.
      const planContext: TutorContext = {
        ...context,
        computedTrace: computation
          ? {
              algorithmId: computation.algorithmId,
              algorithmName: computation.algorithmName,
              result: computation.result,
              guarantee: computation.guarantee,
            }
          : context.computedTrace,
      };
      const result = await withTimeout(
        ai.streamReply(
          planContext,
          wrapped,
          planning
            ? { plan: planning.plan, computation, usedCuratedInput: executed?.usedCuratedInput }
            : undefined,
        ),
      );
      // Guardrails C (secrets) and D (numeric authority) run on the assembled
      // reply, whatever provider produced it.
      const screened = applyReplyGuardrails(result.reply, computation);
      if (screened.leaked.length > 0) {
        // Never forward credential material. Before the first delta the
        // curated fallback answers honestly; after one, the turn fails loudly
        // rather than sending a partially leaked reply.
        if (emitted) throw new Error("provider response contained blocked content");
        throw Object.assign(
          new Error("provider response contained blocked content"),
          { name: "BlockedContentError" },
        );
      }
      const reply = screened.appended.length
        ? { ...result.reply, blocks: [...result.reply.blocks, ...screened.appended] }
        : result.reply;
      return {
        reply,
        streamedDeltas: emitted,
        usage: result.usage,
        computation,
        effectiveTopicId,
        plan: planning?.plan,
      };
    } catch (err) {
      if (emitted || streaming?.signal?.aborted) {
        // Partial AI text is already visible; swapping in curated content
        // here would duplicate or contradict it. Surface the real failure.
        throw err;
      }
      // An AI provider was enabled and attempted, but failed before any
      // user-visible text. The curated fallback answers (the sidebar label
      // alone is not honest about WHY), so log a sanitized diagnostic and
      // carry the reason through to the SSE `done` event. No user message,
      // no credentials.
      if (recordsCooldown(err)) {
        // Record the cooldown BEFORE answering so the next turn cannot spend
        // another request on the limited provider.
        recordProviderCooldown(aiProviderKey, err);
      }
      const fallbackReason = reasonForError(err, aiProviderKey);
      const cooldown = providerCooldown(aiProviderKey);
      console.error(
        JSON.stringify({
          event: "ai_fallback_to_curated",
          provider: aiProviderKey,
          reason: fallbackReason,
          errorName: err instanceof Error ? err.name : "UnknownError",
          status:
            typeof (err as { status?: unknown })?.status === "number"
              ? (err as { status: number }).status
              : null,
          emittedDeltas: emitted,
          ...(cooldown?.quotaMetric ? { quotaMetric: cooldown.quotaMetric } : {}),
          ...(cooldown?.retryDelayMs ? { retryDelayMs: cooldown.retryDelayMs } : {}),
        }),
      );
      try {
        const curated = await runCuratedFallback(context, wrapped);
        streaming?.onResolved?.({
          effectiveTopicId: curated.topicId ?? detectTopicId(context.message, context.topicId),
        });
        return {
          reply: { ...curated, mode: "curated_fallback" },
          streamedDeltas: false,
          effectiveTopicId: curated.topicId ?? detectTopicId(context.message, context.topicId),
          fallbackReason,
        };
      } catch {
        // The message may be off-scope; the route reports a safe error.
        throw err;
      }
    }
  }

  const provider = await createProvider();
  const outcome = await provider.generateReply(context, wrapped);
  const resolvedTopicId = outcome.topicId ?? detectTopicId(context.message, context.topicId);
  streaming?.onResolved?.({ effectiveTopicId: resolvedTopicId });
  return {
    reply: outcome,
    streamedDeltas: emitted,
    effectiveTopicId: resolvedTopicId,
  };
}

/**
 * Non-streaming generation with automatic fallback (used by the JSON route
 * and simple clients). See module docblock for the fallback rules.
 */
export async function generateWithFallback(context: TutorContext): Promise<
  TutorReply & { computation?: SolverResult; effectiveTopicId: string }
> {
  const outcome = await streamWithFallback(context);
  return {
    ...outcome.reply,
    computation: outcome.computation,
    effectiveTopicId: outcome.effectiveTopicId,
  };
}
