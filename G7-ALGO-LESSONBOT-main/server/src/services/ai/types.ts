/**
 * Tutor provider abstraction.
 *
 * The UI depends only on TutorProvider.generateReply(context, streaming).
 * Two implementations exist:
 *   - CuratedFallbackProvider: always available, deterministic, offline.
 *     It emits structured blocks directly (no text deltas — it is not a
 *     generative model and never pretends to stream tokens).
 *   - GeminiTutorProvider: enabled ONLY when the compliance gate passes
 *     (see server/src/config.ts — AI_PROVIDER=gemini + key + owner attestation).
 *     It consumes the model's actual streaming API and forwards text deltas
 *     as they arrive.
 *
 * The Gemini adapter uses the official Google Gen AI SDK. The model ID is
 * configurable via GEMINI_MODEL. Model content is treated as untrusted:
 * it is validated against a schema and never executed or rendered as HTML.
 */
import type { ChatBlock, LearningLevel } from "../../../../shared/contract.js";

export interface TutorContext {
  message: string;
  topicId: string | null;
  level: LearningLevel;
  history: { role: "user" | "assistant"; content: string }[];
  /** Verified solver output the explanation must not contradict. */
  computedTrace?: {
    algorithmId: string;
    algorithmName: string;
    result: Record<string, unknown>;
    guarantee?: string;
  };
}

export interface TutorReply {
  blocks: ChatBlock[];
  mode: "ai" | "curated_fallback";
  /** The topic that actually governed this reply (may differ from selection). */
  topicId?: string;
}

/**
 * Trustworthy usage metadata from the provider, when available. Token counts
 * are only exact when a generative provider reports them; the curated provider
 * reports nothing rather than inventing a count.
 */
export interface TutorUsage {
  model?: string;
  /** Exact output token count reported by the provider, when available. */
  outputTokens?: number;
  inputTokens?: number;
}

export interface TutorStreamHandlers {
  /**
   * Called for each newly generated chunk of text. Implementations must emit
   * only NEW text (never cumulative snapshots and never a repetition of the
   * final assembled reply). The curated provider never calls this.
   */
  onDelta?: (text: string) => void;
  /**
   * Called once the turn's decided context is known (effective topic, plan).
   * For the AI provider this fires right after planning, BEFORE the first
   * delta; for the curated provider it fires after intent resolution.
   */
  onResolved?: (info: { effectiveTopicId: string }) => void;
  /** Abort signal for cancellation; wired to client disconnects. */
  signal?: AbortSignal;
}

export interface TutorProvider {
  readonly name: string;
  generateReply(context: TutorContext, streaming?: TutorStreamHandlers): Promise<TutorReply>;
}
