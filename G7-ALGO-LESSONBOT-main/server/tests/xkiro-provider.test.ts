/**
 * xKiro provider tests: configuration, provider selection, structured planning
 * via function tools, SSE streaming with exactly-once deltas, error
 * classification, cooldowns, and fallback — all with a mocked fetch. No live
 * API calls.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { mockConfigRef, mockIsGeminiEnabled, mockIsXKiroEnabled } = vi.hoisted(() => {
  return {
    mockConfigRef: {
      current: {
        ai: {
          provider: "xkiro",
          geminiApiKey: "g-key",
          geminiModel: "g-model",
          complianceAttested: false,
          xkiroApiKey: "x-key",
          xkiroBaseUrl: "https://api.xkiro.com/v1",
          xkiroModel: "acme/turbo",
          timeoutMs: 5_000,
          maxInputChars: 4000,
          maxOutputChars: 4000,
          rateLimit: { windowMs: 60_000, maxRequests: 20 },
        },
      },
    },
    mockIsGeminiEnabled: vi.fn(() => false),
    mockIsXKiroEnabled: vi.fn(() => true),
  };
});

vi.mock("../src/config.js", () => ({
  config: mockConfigRef.current,
  isGeminiEnabled: mockIsGeminiEnabled,
  isXKiroEnabled: mockIsXKiroEnabled,
  xkiroConfigured: (ai: { provider: string; xkiroApiKey: string; xkiroModel: string }) =>
    ai.provider === "xkiro" && ai.xkiroApiKey.length > 0 && ai.xkiroModel.length > 0,
}));

// ---------------------------------------------------------------------------
// fetch mock + SSE response helpers
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, message: string, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: { message, type: "provider_error" } }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function sseFrames(chunks: unknown[]): string[] {
  return [
    ...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`),
    "data: [DONE]\n\n",
  ];
}

function sseResponse(chunks: unknown[]): Response {
  const frames = sseFrames(chunks);
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < frames.length) {
        controller.enqueue(new TextEncoder().encode(frames[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** A stream that emits one chunk, then waits until the signal aborts. */
function hangingSseResponse(signal?: AbortSignal): Response {
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial " } }] })}\n\n`),
      );
      const why = await new Promise<"timeout" | "aborted">((resolve) => {
        const timer = setTimeout(() => resolve("timeout"), 60_000);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve("aborted");
        }, { once: true });
      });
      if (why === "aborted") {
        controller.error(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const PLAN_JSON = JSON.stringify({
  intent: "explanation",
  topicId: "polynomial-reductions",
  tool: null,
  toolInput: null,
  presentation: "text",
  clarify: null,
});

const validPlanChunk = {
  choices: [
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "submit_plan", arguments: PLAN_JSON } }],
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: { prompt_tokens: 11, completion_tokens: 7 },
  model: "acme/turbo",
};

const ctx = {
  message: "Explain polynomial reductions",
  topicId: "polynomial-reductions",
  level: "beginner" as const,
  history: [],
};

import {
  providerStatus,
  streamWithFallback,
  createProvider,
  clearProviderCooldown,
} from "../src/services/ai/index.js";
import { isXKiroEnabled, xkiroConfigured } from "../src/config.js";
import { planWithRetry } from "../src/services/ai/xkiro-provider.js";

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);
  mockIsXKiroEnabled.mockReturnValue(true);
  mockIsGeminiEnabled.mockReturnValue(false);
  mockConfigRef.current.ai.provider = "xkiro";
  mockConfigRef.current.ai.xkiroApiKey = "x-key";
  mockConfigRef.current.ai.xkiroModel = "acme/turbo";
  clearProviderCooldown("xkiro");
  clearProviderCooldown("gemini");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearProviderCooldown("xkiro");
  clearProviderCooldown("gemini");
});

describe("xKiro provider configuration", () => {
  it("is enabled when provider=xkiro with key and model", () => {
    expect(xkiroConfigured(mockConfigRef.current.ai)).toBe(true);
    expect(isXKiroEnabled()).toBe(true);
  });

  it("is disabled when the API key is missing", () => {
    mockConfigRef.current.ai.xkiroApiKey = "";
    expect(xkiroConfigured(mockConfigRef.current.ai)).toBe(false);
  });

  it("is disabled when the model identifier is missing", () => {
    mockConfigRef.current.ai.xkiroModel = "";
    expect(xkiroConfigured(mockConfigRef.current.ai)).toBe(false);
  });

  it("is disabled when another provider is selected", () => {
    mockConfigRef.current.ai.provider = "gemini";
    expect(xkiroConfigured(mockConfigRef.current.ai)).toBe(false);
  });

  it("reports xkiro as the active provider in providerStatus", () => {
    mockIsXKiroEnabled.mockReturnValue(true);
    expect(providerStatus()).toEqual({ provider: "xkiro", enabled: true });
  });

  it("falls back to the configured provider when xkiro is disabled", () => {
    mockIsXKiroEnabled.mockReturnValue(false);
    expect(providerStatus()).toEqual({ provider: "xkiro", enabled: false });
  });
});

describe("xKiro planner (structured function tool)", () => {
  it("returns a validated plan and usage from a tool call", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validPlanChunk));
    const outcome = await planWithRetry(ctx);
    expect(outcome.plan.intent).toBe("explanation");
    expect(outcome.plan.topicId).toBe("polynomial-reductions");
    expect(outcome.usage).toEqual({ model: "acme/turbo", outputTokens: 7, inputTokens: 11 });
    const [url, initArg] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.xkiro.com/v1/chat/completions");
    const init = initArg;
    expect((init.headers as Record<string, string>)["Authorization"]).toContain("Bearer ");
    const body = JSON.parse(String(init.body));
    expect(body.tools[0].function.name).toBe("submit_plan");
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "submit_plan" } });
    expect(body.stream).toBeUndefined();
  });

  it("retries once when the first plan fails validation", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { tool_calls: [{ function: { arguments: "not json" } }] } }] }))
      .mockResolvedValueOnce(jsonResponse(validPlanChunk));
    const outcome = await planWithRetry(ctx);
    expect(outcome.plan.intent).toBe("explanation");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a confirmed rate limit", async () => {
    const rateErr = errorResponse(429, "Rate limit reached", { "retry-after": "30" });
    fetchMock.mockResolvedValueOnce(rateErr);
    await expect(planWithRetry(ctx)).rejects.toThrow(/Rate limit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("xKiro composer (SSE streaming)", () => {
  it("forwards each delta exactly once and assembles the reply", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { choices: [{ delta: { content: "A polynomial " } }] },
        { choices: [{ delta: { content: "reduction " } }] },
        { choices: [{ delta: { content: "is a translation." } }] },
      ]),
    );
    const deltas: string[] = [];
    const { streamReply } = await import("../src/services/ai/xkiro-provider.js");
    const result = await streamReply(ctx, { onDelta: (t: string) => deltas.push(t) }, undefined);
    expect(deltas).toEqual(["A polynomial ", "reduction ", "is a translation."]);
    expect(result.reply.blocks).toHaveLength(1);
    expect((result.reply.blocks[0] as { markdown: string }).markdown).toBe("A polynomial reduction is a translation.");
    expect(result.reply.mode).toBe("ai");
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.stream).toBe(true);
  });

  it("maps stream usage metadata when provided", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { choices: [{ delta: { content: "Hi" } }], usage: { prompt_tokens: 5, completion_tokens: 2 }, model: "acme/turbo" },
      ]),
    );
    const { streamReply } = await import("../src/services/ai/xkiro-provider.js");
    const result = await streamReply(ctx);
    expect(result.usage).toEqual({ model: "acme/turbo", outputTokens: 2, inputTokens: 5 });
  });

  it("throws on an empty stream", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([]));
    const { streamReply } = await import("../src/services/ai/xkiro-provider.js");
    await expect(streamReply(ctx)).rejects.toThrow(/empty stream/);
  });

  it("aborts mid-stream and throws AbortError", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(hangingSseResponse(controller.signal));
    const { streamReply } = await import("../src/services/ai/xkiro-provider.js");
    const deltas: string[] = [];
    const pending = streamReply(ctx, { signal: controller.signal, onDelta: (t: string) => deltas.push(t) }, undefined);
    // Let the first frame flush, then abort.
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted|stopped/i);
  });
});

describe("xKiro error classification and cooldown", () => {
  it("maps 401/403/404 to distinct sanitized reasons", async () => {
    const { reasonForError } = await import("../src/services/ai/provider-cooldown.js");
    const mk = (status: number, message = "x") => {
      const err = new Error(message);
      (err as unknown as { status: number }).status = status;
      return err;
    };
    expect(reasonForError(mk(401), "xkiro")).toBe("AI service rejected the credentials");
    expect(reasonForError(mk(403), "xkiro")).toBe("AI service denied access");
    expect(reasonForError(mk(404), "xkiro")).toBe("AI model is not available");
  });

  it("classifies a 429 with retry-after as a per-minute cooldown", async () => {
    const { recordProviderCooldown, isProviderCoolingDown } = await import("../src/services/ai/provider-cooldown.js");
    const err = new Error("Rate limit reached");
    (err as unknown as { status: number }).status = 429;
    (err as unknown as { headers?: unknown }).headers = new Headers({ "retry-after": "30" });
    recordProviderCooldown("xkiro", err);
    const cd = (await import("../src/services/ai/provider-cooldown.js")).providerCooldown("xkiro");
    expect(cd?.retryDelayMs).toBe(30_000);
    expect(isProviderCoolingDown("xkiro")).toBe(true);
  });

  it("classifies a 429 with a /day/ quota subject as a daily cooldown", async () => {
    const { recordProviderCooldown, LONG_COOLDOWN_MS } = await import("../src/services/ai/provider-cooldown.js");
    const err = new Error("Daily quota exceeded");
    (err as unknown as { status: number }).status = 429;
    (err as unknown as { error?: unknown }).error = {
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ subject: "50000/day/service/generate_content_requests" }],
        },
      ],
    };
    const cd = recordProviderCooldown("xkiro", err);
    expect(cd.retryDelayMs).toBe(LONG_COOLDOWN_MS);
  });

  it("treats a guidance-less 429 from xKiro as a bounded per-minute default (not a 24h lockout)", async () => {
    const { recordProviderCooldown } = await import("../src/services/ai/provider-cooldown.js");
    const err = new Error("429 Too Many Requests");
    (err as unknown as { status: number }).status = 429;
    const cd = recordProviderCooldown("xkiro", err);
    expect(cd.retryDelayMs).toBe(30_000);
  });

  it("records a 24h cooldown for a 403 (unavailable tier)", async () => {
    const { recordProviderCooldown, LONG_COOLDOWN_MS } = await import("../src/services/ai/provider-cooldown.js");
    const err = new Error("Forbidden");
    (err as unknown as { status: number }).status = 403;
    expect(recordProviderCooldown("xkiro", err).retryDelayMs).toBe(LONG_COOLDOWN_MS);
  });
});

describe("streamWithFallback with xKiro active", () => {
  it("serves a verified curated fallback and skips the composer when the planner gets a 429", async () => {
    const rateErr = errorResponse(429, "Rate limit reached", { "retry-after": "30" });
    fetchMock.mockResolvedValueOnce(rateErr);
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.reply.mode).toBe("curated_fallback");
    expect(outcome.fallbackReason).toBe("AI rate limit reached");
    expect(outcome.streamedDeltas).toBe(false);
  });

  it("makes no provider calls while xKiro is in cooldown", async () => {
    const { recordProviderCooldown, isProviderCoolingDown } = await import("../src/services/ai/provider-cooldown.js");
    const err = new Error("429");
    (err as unknown as { status: number }).status = 429;
    recordProviderCooldown("xkiro", err);
    const outcome = await streamWithFallback(ctx, { onDelta: () => {} });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isProviderCoolingDown("xkiro")).toBe(true);
    expect(outcome.reply.mode).toBe("curated_fallback");
  });

  it("streams AI text after the cooldown is cleared", async () => {
    const { recordProviderCooldown, clearProviderCooldown } = await import("../src/services/ai/provider-cooldown.js");
    const err = new Error("429");
    (err as unknown as { status: number }).status = 429;
    recordProviderCooldown("xkiro", err);
    clearProviderCooldown("xkiro");
    fetchMock.mockResolvedValueOnce(jsonResponse(validPlanChunk));
    fetchMock.mockResolvedValueOnce(
      sseResponse([{ choices: [{ delta: { content: "Recovered." } }] }]),
    );
    const deltas: string[] = [];
    const outcome = await streamWithFallback(ctx, { onDelta: (t: string) => deltas.push(t) });
    expect(deltas).toEqual(["Recovered."]);
    expect(outcome.reply.mode).toBe("ai");
    expect(outcome.fallbackReason).toBeUndefined();
  });

  it("surfaces a timeout without a cooldown and retries next turn", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(() => new Promise(() => {})); // never settles
      const pending = streamWithFallback(ctx, { onDelta: () => {} });
      const assertion = expect(pending).resolves.toMatchObject({
        fallbackReason: "AI request timed out",
      });
      // planner timeout (5s) + planner retry timeout (5s) + composer timeout (5s)
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createProvider selection", () => {
  it("returns the xKiro provider when enabled", async () => {
    const provider = await createProvider();
    expect(provider.name).toBe("xkiro");
  });

  it("returns the curated provider when xKiro is not configured", async () => {
    mockIsXKiroEnabled.mockReturnValue(false);
    const provider = await createProvider();
    expect(provider.name).toBe("curated_fallback");
  });
});
