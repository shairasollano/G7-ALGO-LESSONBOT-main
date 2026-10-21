/**
 * Streaming pipeline tests: real delta forwarding, duplicate prevention, and
 * the no-fallback-after-partial-stream rule.
 *
 * The Gemini SDK is mocked so provider behavior (deltas, failure timing,
 * usage metadata, cancellation) is exercised without network or keys.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mockIsGeminiEnabled, mockConfigRef, streamControl, mockModels } = vi.hoisted(() => {
  return {
    mockIsGeminiEnabled: vi.fn(() => true),
    mockConfigRef: {
      current: {
        ai: {
          provider: "gemini",
          geminiApiKey: "test-...al",
          geminiModel: "test-model",
          complianceAttested: true,
          timeoutMs: 5_000,
          maxInputChars: 4000,
          maxOutputChars: 4000,
          rateLimit: { windowMs: 60_000, maxRequests: 20 },
        },
      },
    },
    streamControl: {
      behavior: undefined as
        | {
            chunks: unknown[];
            failAt?: number;
            failWith?: Error;
            signal?: AbortSignal;
          }
        | undefined,
      /** When set, the planner (generateContent) fails with this error. */
      plannerError: undefined as Error | undefined,
    },
    mockModels: {
      // The planner call. Existing tests rely on it failing (degrade to a
      // planless compose); tests opt into a specific failure via plannerError.
      generateContent: vi.fn(async () => {
        const failWith = streamControl.plannerError;
        if (failWith) throw failWith;
        throw new Error("planner unavailable in mock");
      }),
      generateContentStream: vi.fn(async (params: { config?: { abortSignal?: AbortSignal } }) => {
        const behavior = streamControl.behavior;
        const signal = behavior?.signal ?? params.config?.abortSignal;
        if (!behavior) throw new Error("no stream behavior configured");
        const throwIfAborted = () => {
          if (signal?.aborted) {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            throw err;
          }
        };
        return (async function* () {
          throwIfAborted();
          for (let i = 0; i < behavior.chunks.length; i++) {
            if (behavior.failAt === i) throw behavior.failWith ?? new Error("boom");
            yield behavior.chunks[i];
            throwIfAborted();
          }
          if (behavior.chunks.length === behavior.failAt) {
            throw behavior.failWith ?? new Error("boom");
          }
        })();
      }),
    },
  };
});

vi.mock("../src/config.js", () => ({
  config: mockConfigRef.current,
  isGeminiEnabled: mockIsGeminiEnabled,
  isXKiroEnabled: () => false,
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = mockModels;
  },
}));

const mockConfig = mockConfigRef.current;
void mockConfig;

import {
  streamWithFallback,
  generateWithFallback,
  sanitizeProviderError,
  clearProviderCooldown,
} from "../src/services/ai/index.js";
import { isProviderCoolingDown, recordProviderCooldown } from "../src/services/ai/provider-cooldown.js";

const ctx = {
  message: "Explain polynomial reductions",
  topicId: "polynomial-reductions",
  level: "beginner" as const,
  history: [],
};

describe("streamWithFallback forwards real deltas", () => {
  beforeEach(() => {
    mockIsGeminiEnabled.mockReturnValue(true);
    // Deterministic defaults: the planner fails non-rate-limited (degrade to a
    // planless compose) and no provider cooldown is active.
    streamControl.plannerError = new Error("planner unavailable in mock");
    clearProviderCooldown("gemini");
    mockModels.generateContent.mockClear();
    mockModels.generateContentStream.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    clearProviderCooldown("gemini");
  });

  it("emits each provider chunk exactly once, in order, as deltas", async () => {
    streamControl.behavior = {
      chunks: [
        { text: "A polynomial reduction " },
        { text: "is a translation " },
        { text: "between problems." },
      ],
    };
    const deltas: string[] = [];
    const outcome = await streamWithFallback(ctx, { onDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual([
      "A polynomial reduction ",
      "is a translation ",
      "between problems.",
    ]);
    expect(outcome.streamedDeltas).toBe(true);
    expect(outcome.reply.mode).toBe("ai");
    // The assembled reply is one text block whose content is exactly the
    // concatenation — not a cumulative snapshot, not a resend.
    const textBlocks = outcome.reply.blocks.filter((b) => b.type === "text");
    expect(textBlocks).toHaveLength(1);
    if (textBlocks[0]?.type === "text") {
      expect(textBlocks[0].markdown).toBe(deltas.join(""));
    }
  });

  it("surfaces exact provider token counts in usage metadata when available", async () => {
    streamControl.behavior = {
      chunks: [
        { text: "Hello" },
        {
          text: " world",
          usageMetadata: { candidatesTokenCount: 42, promptTokenCount: 11 },
          modelVersion: "test-model",
        },
      ],
    };
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(outcome.usage).toEqual({
      model: "test-model",
      outputTokens: 42,
      inputTokens: 11,
    });
  });

  it("falls back to the curated provider when it fails before the first delta", async () => {
    streamControl.behavior = { chunks: [], failAt: 0, failWith: new Error("quota exceeded") };
    const deltas: string[] = [];
    const outcome = await streamWithFallback(ctx, { onDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual([]);
    expect(outcome.streamedDeltas).toBe(false);
    expect(outcome.reply.mode).toBe("curated_fallback");
    expect(outcome.reply.blocks.length).toBeGreaterThan(0);
  });

  it("labels a successful Gemini stream as AI-generated with no fallback reason", async () => {
    streamControl.behavior = { chunks: [{ text: "Hello" }, { text: " world" }] };
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(outcome.reply.mode).toBe("ai");
    expect(outcome.streamedDeltas).toBe(true);
    expect(outcome.fallbackReason).toBeUndefined();
  });

  it("records a sanitized fallback reason and logs a diagnostic when Gemini fails before the first delta", async () => {
    const authErr = new Error("401 Unauthorized");
    (authErr as unknown as { status: number }).status = 401;
    streamControl.behavior = { chunks: [], failAt: 0, failWith: authErr };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(outcome.reply.mode).toBe("curated_fallback");
    expect(outcome.fallbackReason).toBe("AI service rejected the credentials");
    // The diagnostic identifies the attempted provider and failure class, and
    // never embeds the user's message or credential material.
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"event":"ai_fallback_to_curated"');
    expect(logged).toContain('"provider":"gemini"');
    expect(logged).toContain('"reason":"AI service rejected the credentials"');
    expect(logged).toContain('"status":401');
    expect(logged).not.toContain(ctx.message);
    errSpy.mockRestore();
  });

  it("maps SDK statuses and error classes to distinct sanitized reasons", () => {
    const withStatus = (status: number) => {
      const e = new Error("x");
      (e as unknown as { status: number }).status = status;
      return e;
    };
    expect(sanitizeProviderError(withStatus(401))).toBe("AI service rejected the credentials");
    expect(sanitizeProviderError(withStatus(403))).toBe("AI service denied access");
    expect(sanitizeProviderError(withStatus(404))).toBe("AI model is not available");
    expect(sanitizeProviderError(withStatus(429))).toBe("AI rate limit reached");
    expect(sanitizeProviderError(withStatus(429), "gemini")).toBe("AI access is not available");
    expect(
      sanitizeProviderError(rateLimitError({ quotaSubject: "50000/day/service/generate_content_requests" })),
    ).toBe("AI daily quota exhausted");
    expect(sanitizeProviderError(rateLimitError({ retryAfter: "30" }))).toBe("AI rate limit reached");
    expect(sanitizeProviderError(withStatus(400))).toBe("AI request was rejected");
    expect(
      sanitizeProviderError(Object.assign(new Error("AI request timed out"), { name: "TimeoutError" })),
    ).toBe("AI request timed out");
    expect(sanitizeProviderError(new Error("something else"))).toBe("AI provider error");
  });

  function rateLimitError(opts?: { retryAfter?: string; retryDelay?: string; quotaSubject?: string }): Error {
    const err = new Error("429 Too Many Requests");
    (err as unknown as { status: number }).status = 429;
    const headers = new Map<string, string>();
    if (opts?.retryAfter) headers.set("retry-after", opts.retryAfter);
    (err as { headers?: unknown }).headers = { get: (k: string) => headers.get(k) ?? null };
    const details: Record<string, unknown>[] = [];
    if (opts?.retryDelay) {
      details.push({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: opts.retryDelay });
    }
    if (opts?.quotaSubject) {
      details.push({
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ subject: opts.quotaSubject, description: "quota exceeded" }],
      });
    }
    if (details.length > 0) (err as { error?: unknown }).error = { details };
    return err;
  }

  it("does not retry the planner and skips the composer when the planner returns 429", async () => {
    streamControl.plannerError = rateLimitError({ retryAfter: "30" });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    // One planner call, no retry, and the composer is never reached.
    expect(mockModels.generateContent).toHaveBeenCalledTimes(1);
    expect(mockModels.generateContentStream).not.toHaveBeenCalled();
    expect(outcome.reply.mode).toBe("curated_fallback");
    expect(outcome.fallbackReason).toBe("AI rate limit reached");
    // The cooldown is recorded so the next turn cannot spend a request either.
    expect(isProviderCoolingDown("gemini")).toBe(true);
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"event":"ai_fallback_to_curated"');
    expect(logged).toContain('"reason":"AI rate limit reached"');
    expect(logged).toContain('"status":429');
    errSpy.mockRestore();
  });

  it("records a cooldown when the composer fails with 429 before the first delta", async () => {
    // Default planner failure is non-429 (planless compose); the composer
    // then fails with a confirmed per-minute 429 before streaming anything.
    streamControl.behavior = { chunks: [], failAt: 0, failWith: rateLimitError({ retryAfter: "30" }) };
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(mockModels.generateContentStream).toHaveBeenCalledTimes(1);
    expect(outcome.reply.mode).toBe("curated_fallback");
    expect(outcome.fallbackReason).toBe("AI rate limit reached");
    expect(isProviderCoolingDown("gemini")).toBe(true);
  });

  it("does not retry a per-minute limit inside the cooldown window and recovers after it", async () => {
    vi.useFakeTimers();
    try {
      // First turn: per-minute 429 with retry-after 30s → short cooldown.
      streamControl.plannerError = rateLimitError({ retryAfter: "30" });
      const first = await streamWithFallback(ctx, { onDelta: () => {} });
      expect(first.fallbackReason).toBe("AI rate limit reached");
      expect(isProviderCoolingDown("gemini")).toBe(true);
      const callsAfterFirst = mockModels.generateContent.mock.calls.length;

      // 5 minutes later — well past a per-minute window — the provider is
      // called again and succeeds.
      vi.setSystemTime(Date.now() + 5 * 60_000);
      streamControl.plannerError = new Error("planner unavailable in mock");
      streamControl.behavior = { chunks: [{ text: "Recovered" }] };
      const second = await streamWithFallback(ctx, { onDelta: () => {} });
      expect(second.reply.mode).toBe("ai");
      expect(mockModels.generateContent.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never re-probes a daily-quota failure throughout the day", async () => {
    vi.useFakeTimers();
    try {
      // First turn: confirmed daily-quota 429 (subject names the day period).
      streamControl.plannerError = rateLimitError({
        quotaSubject: "50000/day/service/generate_content_requests",
      });
      const first = await streamWithFallback(ctx, { onDelta: () => {} });
      expect(first.reply.mode).toBe("curated_fallback");
      expect(first.fallbackReason).toBe("AI daily quota exhausted");
      const callsAfterFirst = mockModels.generateContent.mock.calls.length;

      // Advance 5 minutes, then nearly a full day: the provider must not be
      // called again in either window — no periodic daily retries.
      for (const advance of [5 * 60_000, 23 * 3_600_000]) {
        vi.setSystemTime(Date.now() + advance);
        const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
        expect(outcome.reply.mode).toBe("curated_fallback");
        expect(outcome.fallbackReason).toBe("AI daily quota exhausted");
      }
      expect(mockModels.generateContent.mock.calls.length).toBe(callsAfterFirst);
      expect(mockModels.generateContentStream).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never re-probes an unavailable-tier (403) failure throughout the day", async () => {
    vi.useFakeTimers();
    try {
      const forbidden = new Error("403 Forbidden");
      (forbidden as unknown as { status: number }).status = 403;
      streamControl.plannerError = forbidden;
      const first = await streamWithFallback(ctx, { onDelta: () => {} });
      expect(first.reply.mode).toBe("curated_fallback");
      expect(first.fallbackReason).toBe("AI service denied access");
      const callsAfterFirst = mockModels.generateContent.mock.calls.length;

      for (const advance of [5 * 60_000, 23 * 3_600_000]) {
        vi.setSystemTime(Date.now() + advance);
        const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
        expect(outcome.reply.mode).toBe("curated_fallback");
        expect(outcome.fallbackReason).toBe("AI service denied access");
      }
      expect(mockModels.generateContent.mock.calls.length).toBe(callsAfterFirst);
      expect(mockModels.generateContentStream).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never re-probes a bare 429 without retry guidance (entitlement restriction)", async () => {
    vi.useFakeTimers();
    try {
      streamControl.plannerError = rateLimitError();
      const first = await streamWithFallback(ctx, { onDelta: () => {} });
      expect(first.reply.mode).toBe("curated_fallback");
      expect(first.fallbackReason).toBe("AI access is not available");
      const callsAfterFirst = mockModels.generateContent.mock.calls.length;

      for (const advance of [5 * 60_000, 23 * 3_600_000]) {
        vi.setSystemTime(Date.now() + advance);
        const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
        expect(outcome.fallbackReason).toBe("AI access is not available");
      }
      expect(mockModels.generateContent.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the composer when the planner fails with a non-retryable restriction", async () => {
    const notFound = new Error("404 Not Found");
    (notFound as unknown as { status: number }).status = 404;
    streamControl.plannerError = notFound;
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(mockModels.generateContent).toHaveBeenCalledTimes(1);
    expect(mockModels.generateContentStream).not.toHaveBeenCalled();
    expect(outcome.reply.mode).toBe("curated_fallback");
    expect(outcome.fallbackReason).toBe("AI model is not available");
    expect(isProviderCoolingDown("gemini")).toBe(true);
  });

  it("leaves transient errors (timeout) without a cooldown so the next turn retries immediately", async () => {
    const timeout = () => Object.assign(new Error("AI request timed out"), { name: "TimeoutError" });
    streamControl.plannerError = timeout();
    streamControl.behavior = { chunks: [], failAt: 0, failWith: timeout() };
    const first = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(first.fallbackReason).toBe("AI request timed out");
    expect(isProviderCoolingDown("gemini")).toBe(false);
    // The very next turn calls the provider again — no cooldown recorded.
    streamControl.plannerError = new Error("planner unavailable in mock");
    streamControl.behavior = { chunks: [{ text: "ok" }] };
    const second = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(second.reply.mode).toBe("ai");
  });

  it("makes no Gemini calls while the provider is in cooldown", async () => {
    recordProviderCooldown("gemini", rateLimitError({ retryAfter: "30" }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(mockModels.generateContent).not.toHaveBeenCalled();
    expect(mockModels.generateContentStream).not.toHaveBeenCalled();
    expect(outcome.reply.mode).toBe("curated_fallback");
    expect(outcome.fallbackReason).toBe("AI rate limit reached");
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain('"cooldownActive":true');
    errSpy.mockRestore();
  });

  it("resumes Gemini calls after the cooldown is cleared", async () => {
    recordProviderCooldown("gemini", rateLimitError());
    expect(isProviderCoolingDown("gemini")).toBe(true);
    clearProviderCooldown("gemini");
    streamControl.behavior = { chunks: [{ text: "Back" }, { text: " online." }] };
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(mockModels.generateContentStream).toHaveBeenCalledTimes(1);
    expect(outcome.reply.mode).toBe("ai");
    expect(outcome.fallbackReason).toBeUndefined();
  });

  it("does NOT substitute curated content after partial AI text was streamed", async () => {
    streamControl.behavior = {
      chunks: [{ text: "Here is the beginning of the explanation." }],
      failAt: 1,
      failWith: new Error("connection reset"),
    };
    const deltas: string[] = [];
    await expect(
      streamWithFallback(ctx, { onDelta: (t) => deltas.push(t) }),
    ).rejects.toThrow(/connection reset|Gemini provider failed/);
    expect(deltas).toEqual(["Here is the beginning of the explanation."]);
  });

  it("rejects when the client aborts the stream (no curated content either)", async () => {
    streamControl.behavior = { chunks: [{ text: "partial " }, { text: "text" }] };
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamWithFallback(ctx, { signal: controller.signal, onDelta: () => {} }),
    ).rejects.toThrow();
  });
});

describe("generateWithFallback (non-streaming path)", () => {
  it("falls back to curated content when the AI provider fails completely", async () => {
    streamControl.behavior = { chunks: [], failAt: 0, failWith: new Error("boom") };
    const reply = await generateWithFallback(ctx);
    expect(reply.mode).toBe("curated_fallback");
    expect(reply.blocks.length).toBeGreaterThan(0);
  });
});
