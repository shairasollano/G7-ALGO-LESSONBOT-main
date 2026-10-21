/**
 * Test isolation: the package .env (which enables real providers for dev)
 * must never leak into the deterministic test suite. Pinning these first
 * means the config module's .env loader respects the pre-set test defaults
 * (it only fills keys that are unset).
 */
process.env.AI_PROVIDER = process.env.AI_PROVIDER ?? "curated";
process.env.GEMINI_AUDIENCE_COMPLIANCE_ATTESTED =
  process.env.GEMINI_AUDIENCE_COMPLIANCE_ATTESTED ?? "";
// The suite drives many more AI-route requests in a few seconds than a real
// user would; the limiter exists to bound live provider spend, not to make
// deterministic tests flaky. No test asserts limiter behaviour.
process.env.AI_RATE_LIMIT_MAX = process.env.AI_RATE_LIMIT_MAX ?? "100000";
