/**
 * Per-provider rate-limit cooldown with failure-category classification.
 *
 * The Gemini SDK throws typed errors whose structured payload carries
 * non-secret retry guidance:
 *   - HTTP 401/403/404 → AuthenticationError / PermissionDeniedError /
 *     NotFoundError: auth, access-tier, or model-availability restrictions.
 *   - HTTP 429 → RateLimitError, optionally with:
 *     - a `retry-after` response header (seconds),
 *     - a `google.rpc.RetryInfo` detail with a protobuf duration (`"42s"`),
 *     - a `google.rpc.QuotaFailure` detail whose violation subject names the
 *       exhausted metric and period, e.g. `.../minute/...` or `.../day/...`.
 *
 * Only these structured fields are read — never raw response bodies, keys, or
 * user content.
 *
 * Cooldown policy per category:
 *   - per-minute rate limit: respect a valid server retry delay (bounded);
 *     otherwise a short default. Recovers automatically.
 *   - daily-quota exhaustion: the error payload carries NO verified reset
 *     time, so a LONG cooldown (24h) applies — at most one controlled probe
 *     per day, never periodic retries throughout the day. If the server did
 *     supply a retry delay, that verified delay is honored instead.
 *   - non-retryable restrictions (401/403/404, or a bare 429 with no quota
 *     period and no retry guidance — an entitlement/tier restriction that
 *     waiting cannot resolve): LONG cooldown (24h), same single-probe rule.
 *   - transient errors (timeouts, connection errors, other failures): no
 *     cooldown — they are retried on the next turn as before.
 */

export type ProviderErrorCategory = "per-minute" | "daily-quota" | "non-retryable" | "other";

export interface ProviderCooldown {
  provider: string;
  /** Epoch milliseconds after which the provider may be called again. */
  until: number;
  /** Sanitized, user-presentable reason recorded with the cooldown. */
  reason: string;
  /** Effective cooldown length in ms (the structured guidance used). */
  retryDelayMs?: number;
  /** Quota metric subject, e.g. `1000000/minute/.../generate_content_requests`. */
  quotaMetric?: string;
}

export interface ProviderErrorClassification {
  category: ProviderErrorCategory;
  retryDelayMs?: number;
  quotaMetric?: string;
}

/**
 * Cooldown classification is provider-aware where error semantics differ:
 * Google almost always sends RetryInfo/QuotaFailure for 429s, so a guidance-
 * less 429 from Gemini is treated as an entitlement/tier restriction (long
 * cooldown). xKiro 429s routinely arrive with no guidance and are typically
 * temporary per-minute limits, so a guidance-less 429 from xKiro (or an
 * unknown provider) gets the bounded per-minute default instead.
 */
export type CooldownProviderKey = "gemini" | "xkiro";

/** Bounded defaults (ms). */
export const DEFAULT_COOLDOWN_MS = 30_000;
/** Cap for server-provided per-minute retry delays. */
export const MAX_COOLDOWN_MS = 10 * 60_000;
/**
 * Long cooldown for restrictions that waiting cannot resolve within a day:
 * confirmed daily-quota exhaustion (no reset time in the error payload) and
 * non-retryable auth/tier/permission errors. At most one controlled probe
 * per day — never periodic retries throughout the day.
 */
export const LONG_COOLDOWN_MS = 24 * 60 * 60_000;

const cooldowns = new Map<string, ProviderCooldown>();

/** True while the provider's recorded cooldown has not expired. */
export function isProviderCoolingDown(provider: string, now: number = Date.now()): boolean {
  const cd = cooldowns.get(provider);
  return Boolean(cd && cd.until > now);
}

/** Current cooldown record, if any (for diagnostics and tests). */
export function providerCooldown(provider: string): ProviderCooldown | undefined {
  return cooldowns.get(provider);
}

/** Test/diagnostic hook: drop a provider's cooldown record. */
export function clearProviderCooldown(provider: string): void {
  cooldowns.delete(provider);
}

/** A confirmed rate limit: SDK 429 status, or a RateLimitError by class name. */
export function isProviderRateLimited(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  if (status === 429) return true;
  const name = (err as { name?: unknown }).name;
  return typeof name === "string" && /ratelimit/i.test(name);
}

/**
 * A restriction that waiting cannot resolve: auth/model/permission failures
 * (401/403/404) or a 429 with no quota period and no retry guidance
 * (entitlement/tier restriction). These record the long cooldown.
 */
export function isNonRetryableRestriction(err: unknown): boolean {
  return classifyProviderError(err).category === "non-retryable";
}

/** True when a failure should record a cooldown (no point retrying immediately). */
export function recordsCooldown(err: unknown): boolean {
  return isProviderRateLimited(err) || isNonRetryableRestriction(err);
}

/** Parse a protobuf duration string (`"42s"`, `"1m30s"`, `"2h"`) to ms. */
function parseDurationMs(dur: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(dur.trim());
  if (!m) return undefined;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unitMs = m[2] === "s" ? 1_000 : m[2] === "m" ? 60_000 : 3_600_000;
  return value * unitMs;
}

function errorDetails(err: unknown): unknown[] {
  const details = (err as { error?: { details?: unknown } })?.error?.details;
  return Array.isArray(details) ? details : [];
}

/** `retry-after` header (seconds) — the server's own retry guidance. */
function extractRetryAfterMs(err: unknown): number | undefined {
  const headers = (err as { headers?: { get?: (name: string) => string | null } })?.headers;
  const raw = headers?.get?.("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return seconds * 1_000;
}

/** `RetryInfo.retryDelay` from the structured error body. */
function extractRetryInfoMs(err: unknown): number | undefined {
  for (const detail of errorDetails(err)) {
    const retryDelay = (detail as { retryDelay?: unknown })?.retryDelay;
    if (typeof retryDelay !== "string") continue;
    const ms = parseDurationMs(retryDelay);
    if (ms !== undefined) return ms;
  }
  return undefined;
}

/** Quota metric subject from `QuotaFailure` violations, if present. */
function extractQuotaMetric(err: unknown): string | undefined {
  for (const detail of errorDetails(err)) {
    const violations = (detail as { violations?: unknown })?.violations;
    if (!Array.isArray(violations)) continue;
    for (const violation of violations) {
      const subject = (violation as { subject?: unknown })?.subject;
      if (typeof subject === "string" && subject.length > 0) return subject;
    }
  }
  return undefined;
}

/**
 * Classify a provider failure using only structured error information.
 * Returns "other" for transient errors (timeouts, connection errors) that
 * carry no rate-limit structure — those never record a cooldown.
 */
export function classifyProviderError(
  err: unknown,
  providerKey?: CooldownProviderKey,
): ProviderErrorClassification {
  const status =
    typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined;
  const quotaMetric = extractQuotaMetric(err);

  // Hard auth/permission/model failures cannot be resolved by waiting.
  if (status === 401 || status === 403 || status === 404) {
    return { category: "non-retryable", ...(quotaMetric ? { quotaMetric } : {}) };
  }

  const rateLimited = isProviderRateLimited(err);
  if (!rateLimited) {
    return { category: "other", ...(quotaMetric ? { quotaMetric } : {}) };
  }

  // Confirmed rate limit — distinguish by the structured quota period.
  if (quotaMetric && /day/i.test(quotaMetric)) {
    // A server-supplied retry delay is verified reset guidance; honor it
    // (bounded by the long cooldown). Otherwise the payload carries no
    // reset time → the long cooldown applies.
    const retryDelayMs = extractRetryAfterMs(err) ?? extractRetryInfoMs(err);
    return { category: "daily-quota", quotaMetric, ...(retryDelayMs ? { retryDelayMs } : {}) };
  }
  if (quotaMetric && /minute|second/i.test(quotaMetric)) {
    const retryDelayMs = extractRetryAfterMs(err) ?? extractRetryInfoMs(err);
    return { category: "per-minute", quotaMetric, ...(retryDelayMs ? { retryDelayMs } : {}) };
  }
  // A 429 with server-provided retry guidance is a temporary limit.
  const retryDelayMs = extractRetryAfterMs(err) ?? extractRetryInfoMs(err);
  if (retryDelayMs !== undefined) {
    return { category: "per-minute", retryDelayMs };
  }
  // A guidance-less 429: Google treats it as an entitlement/tier restriction
  // (long cooldown); xKiro 429s are routinely temporary per-minute limits, so
  // they get the bounded per-minute default.
  if (providerKey === "gemini") {
    return { category: "non-retryable" };
  }
  return { category: "per-minute" };
}

/**
 * Sanitized, user-presentable reason for a failure. Single source shared by
 * the fallback diagnostic and the cooldown record. Never forwards raw error
 * text. Unknown or unspecified restrictions keep their generic label.
 */
export function reasonForError(err: unknown, providerKey?: CooldownProviderKey): string {
  const { category } = classifyProviderError(err, providerKey);
  if (category === "daily-quota") return "AI daily quota exhausted";
  if (category === "non-retryable") {
    if (!isProviderRateLimited(err)) {
      const status =
        typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined;
      if (status === 401) return "AI service rejected the credentials";
      if (status === 403) return "AI service denied access";
      if (status === 404) return "AI model is not available";
    }
    return "AI access is not available";
  }
  const name = err instanceof Error ? err.name : "UnknownError";
  const status =
    typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : undefined;
  if (status === 400) return "AI request was rejected";
  if (status === 402) return "AI quota or billing issue";
  if (/timeout|timed out/i.test(name)) return "AI request timed out";
  if (/authentication|unauthorized/i.test(name)) return "AI service rejected the credentials";
  if (/not found/i.test(name)) return "AI model is not available";
  if (status === 429) return "AI rate limit reached";
  if (/rate ?limit/i.test(name)) return "AI rate limit reached";
  return "AI provider error";
}

/**
 * Cooldown length for a failed request, by category:
 *   - per-minute: respect a valid server retry delay (capped), else default.
 *   - daily-quota: honor a verified retry delay if supplied; otherwise the
 *     long cooldown — the error payload provides no reset time, so the
 *     provider is never re-probed periodically throughout the day.
 *   - non-retryable: the long cooldown (one controlled probe per day).
 *   - other (transient): no cooldown is recorded by callers.
 */
export function cooldownMsForError(err: unknown, providerKey?: CooldownProviderKey): number {
  const { category, retryDelayMs } = classifyProviderError(err, providerKey);
  switch (category) {
    case "per-minute":
      return Math.min(retryDelayMs ?? DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS);
    case "daily-quota":
      return Math.min(retryDelayMs ?? LONG_COOLDOWN_MS, LONG_COOLDOWN_MS);
    case "non-retryable":
      return LONG_COOLDOWN_MS;
    default:
      return DEFAULT_COOLDOWN_MS;
  }
}

/**
 * Record a cooldown for a provider from a failed request error. Returns the
 * record so callers can include its structured fields in diagnostics.
 */
export function recordProviderCooldown(
  provider: CooldownProviderKey,
  err: unknown,
  now: number = Date.now(),
): ProviderCooldown {
  const cooldownMs = cooldownMsForError(err, provider);
  const record: ProviderCooldown = {
    provider,
    until: now + cooldownMs,
    reason: reasonForError(err, provider),
    retryDelayMs: cooldownMs,
  };
  const { quotaMetric } = classifyProviderError(err, provider);
  if (quotaMetric) record.quotaMetric = quotaMetric;
  cooldowns.set(provider, record);
  return record;
}
