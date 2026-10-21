/**
 * Per-provider rate-limit cooldown: structured retry-guidance parsing,
 * bounded cooldown selection, and recovery semantics. Pure module tests —
 * no SDK, no network.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyProviderError,
  clearProviderCooldown,
  cooldownMsForError,
  DEFAULT_COOLDOWN_MS,
  isProviderCoolingDown,
  isProviderRateLimited,
  isNonRetryableRestriction,
  LONG_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  providerCooldown,
  reasonForError,
  recordProviderCooldown,
} from "../src/services/ai/provider-cooldown.js";

const NOW = 1_700_000_000_000;

function rateLimitError(init?: {
  status?: number;
  retryAfter?: string;
  retryDelay?: string;
  quotaSubject?: string;
}): Error {
  const err = new Error("Too Many Requests");
  (err as unknown as { status: number }).status = init?.status ?? 429;
  const headers = new Map<string, string>();
  if (init?.retryAfter !== undefined) headers.set("retry-after", init.retryAfter);
  (err as { headers?: unknown }).headers = { get: (k: string) => headers.get(k) ?? null };
  const details: Record<string, unknown>[] = [];
  if (init?.retryDelay !== undefined) {
    details.push({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: init.retryDelay });
  }
  if (init?.quotaSubject !== undefined) {
    details.push({
      "@type": "type.googleapis.com/google.rpc.QuotaFailure",
      violations: [{ subject: init.quotaSubject, description: "quota exceeded" }],
    });
  }
  if (details.length > 0) (err as { error?: unknown }).error = { details };
  return err;
}

afterEach(() => {
  clearProviderCooldown("gemini");
});

describe("isProviderRateLimited", () => {
  it("detects a confirmed 429 by status or RateLimitError class name", () => {
    expect(isProviderRateLimited(rateLimitError({ status: 429 }))).toBe(true);
    expect(isProviderRateLimited(Object.assign(new Error("x"), { name: "RateLimitError" }))).toBe(true);
    expect(isProviderRateLimited(rateLimitError({ status: 401 }))).toBe(false);
    expect(isProviderRateLimited(new Error("boom"))).toBe(false);
    expect(isProviderRateLimited(undefined)).toBe(false);
  });
});

describe("classifyProviderError — failure categories", () => {
  it("classifies per-minute, daily-quota, and non-retryable restrictions", () => {
    expect(
      classifyProviderError(
        rateLimitError({ quotaSubject: "1000000/minute/service/generate_content_requests" }),
      ).category,
    ).toBe("per-minute");
    expect(
      classifyProviderError(rateLimitError({ quotaSubject: "50000/day/service/generate_content_requests" })).category,
    ).toBe("daily-quota");
    // A 429 with server retry guidance is a temporary per-minute limit.
    expect(classifyProviderError(rateLimitError({ retryAfter: "30" })).category).toBe("per-minute");
    expect(classifyProviderError(rateLimitError({ retryDelay: "42s" })).category).toBe("per-minute");
    // A bare 429 with no quota period and no retry guidance: from Gemini this
    // is an entitlement/tier restriction (strict); from xKiro a bounded
    // per-minute default applies.
    expect(classifyProviderError(rateLimitError()).category).toBe("per-minute");
    expect(classifyProviderError(rateLimitError(), "gemini").category).toBe("non-retryable");
    // Hard auth/permission/model failures are non-retryable restrictions.
    expect(classifyProviderError(rateLimitError({ status: 401 })).category).toBe("non-retryable");
    expect(classifyProviderError(rateLimitError({ status: 403 })).category).toBe("non-retryable");
    expect(classifyProviderError(rateLimitError({ status: 404 })).category).toBe("non-retryable");
    // Transient errors carry no rate-limit structure.
    expect(classifyProviderError(new Error("socket hangup")).category).toBe("other");
    expect(classifyProviderError(Object.assign(new Error("t"), { name: "TimeoutError" })).category).toBe("other");
  });

  it("keeps the daily-quota retry delay when the server supplies one", () => {
    const result = classifyProviderError(
      rateLimitError({ quotaSubject: "50000/day/service/generate_content_requests", retryAfter: "3600" }),
    );
    expect(result.category).toBe("daily-quota");
    expect(result.retryDelayMs).toBe(3_600_000);
  });
});

describe("reasonForError — sanitized, category-aware reasons", () => {
  it("names each category distinctly", () => {
    expect(
      reasonForError(rateLimitError({ quotaSubject: "50000/day/service/generate_content_requests" })),
    ).toBe("AI daily quota exhausted");
    expect(reasonForError(rateLimitError({ retryAfter: "30" }))).toBe("AI rate limit reached");
    expect(reasonForError(rateLimitError())).toBe("AI rate limit reached");
    expect(reasonForError(rateLimitError(), "gemini")).toBe("AI access is not available");
    expect(reasonForError(rateLimitError({ status: 401 }))).toBe("AI service rejected the credentials");
    expect(reasonForError(rateLimitError({ status: 403 }))).toBe("AI service denied access");
    expect(reasonForError(rateLimitError({ status: 404 }))).toBe("AI model is not available");
  });
});

describe("cooldownMsForError — structured guidance precedence", () => {
  it("respects a server-provided retry-after header", () => {
    expect(cooldownMsForError(rateLimitError({ status: 429, retryAfter: "42" }))).toBe(42_000);
  });

  it("parses RetryInfo.retryDelay from the error body", () => {
    expect(cooldownMsForError(rateLimitError({ status: 429, retryDelay: "15s" }))).toBe(15_000);
    expect(cooldownMsForError(rateLimitError({ status: 429, retryDelay: "2m" }))).toBe(120_000);
  });

  it("uses the long cooldown for a daily-quota subject without a verified reset time", () => {
    const ms = cooldownMsForError(
      rateLimitError({ status: 429, quotaSubject: "10000000/day/service/generate_content_requests" }),
    );
    expect(ms).toBe(LONG_COOLDOWN_MS);
  });

  it("honors a verified retry delay for a daily-quota subject when supplied", () => {
    const ms = cooldownMsForError(
      rateLimitError({ status: 429, quotaSubject: "50000/day/service/generate_content_requests", retryAfter: "3600" }),
    );
    expect(ms).toBe(3_600_000);
  });

  it("uses the bounded default for a per-minute subject", () => {
    expect(
      cooldownMsForError(rateLimitError({ status: 429, quotaSubject: "1000000/minute/service/generate_content" })),
    ).toBe(DEFAULT_COOLDOWN_MS);
  });

  it("uses the long cooldown for non-retryable restrictions", () => {
    expect(cooldownMsForError(rateLimitError({ status: 401 }))).toBe(LONG_COOLDOWN_MS);
    expect(cooldownMsForError(rateLimitError({ status: 403 }))).toBe(LONG_COOLDOWN_MS);
    expect(cooldownMsForError(rateLimitError({ status: 404 }))).toBe(LONG_COOLDOWN_MS);
    // Gemini strictness for a guidance-less 429; xKiro uses the bounded default.
    expect(cooldownMsForError(rateLimitError(), "gemini")).toBe(LONG_COOLDOWN_MS);
    expect(cooldownMsForError(rateLimitError())).toBe(DEFAULT_COOLDOWN_MS);
  });

  it("caps server-provided per-minute delays at the maximum", () => {
    expect(cooldownMsForError(rateLimitError({ status: 429, retryAfter: "3600" }))).toBe(MAX_COOLDOWN_MS);
  });

  it("leaves transient errors without a cooldown category", () => {
    expect(classifyProviderError(new Error("socket hangup")).category).toBe("other");
  });
});

describe("cooldown lifecycle", () => {
  it("blocks the provider while cooling down and allows recovery after expiry", () => {
    recordProviderCooldown("gemini", rateLimitError({ status: 429, retryAfter: "30" }), NOW);
    expect(isProviderCoolingDown("gemini", NOW)).toBe(true);
    expect(isProviderCoolingDown("gemini", NOW + 29_999)).toBe(true);
    expect(isProviderCoolingDown("gemini", NOW + 30_001)).toBe(false);
  });

  it("records structured, non-secret diagnostic fields", () => {
    const record = recordProviderCooldown(
      "gemini",
      rateLimitError({ status: 429, retryAfter: "42", quotaSubject: "1000000/minute/service/generate_content" }),
      NOW,
    );
    expect(record.until).toBe(NOW + 42_000);
    expect(record.reason).toBe("AI rate limit reached");
    expect(record.retryDelayMs).toBe(42_000);
    expect(record.quotaMetric).toContain("minute");
    expect(providerCooldown("gemini")).toEqual(record);
  });

  it("clearProviderCooldown drops the record (test hook)", () => {
    recordProviderCooldown("gemini", rateLimitError({ status: 429 }), NOW);
    expect(isProviderCoolingDown("gemini", NOW)).toBe(true);
    clearProviderCooldown("gemini");
    expect(isProviderCoolingDown("gemini", NOW)).toBe(false);
    expect(providerCooldown("gemini")).toBeUndefined();
  });
});
