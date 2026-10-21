/**
 * Generation-speed benchmark (measurement, not marketing).
 *
 * Measures, for a fixed prompt, across N runs:
 *   - time to first output (TTFT): first text delta or first block
 *   - total generation duration
 *   - streaming duration (first output -> completion)
 *   - output token count: exact provider-reported tokens when the provider
 *     supplies usage metadata; otherwise an EVALUATION-BASED ESTIMATE that is
 *     explicitly labelled as such in the output
 *   - output tokens per second = output tokens / streaming duration,
 *     excluding everything before the first generated output
 *
 * The script never reports a target; it reports what was measured in this
 * environment. It does not log API keys or user content; prompts below are
 * fixed benchmark text.
 *
 * Run with: npm --prefix server run bench
 */
import { streamWithFallback, providerStatus } from "../src/services/ai/index.js";
import { config, isGeminiEnabled } from "../src/config.js";

interface RunResult {
  run: number;
  ttftMs: number | null;
  totalMs: number;
  streamingMs: number | null;
  tokens: number;
  tokensEstimated: boolean;
  tokensPerSecond: number | null;
  errored: boolean;
  cancelled: boolean;
  timedOut: boolean;
}

const PROMPT = "Explain polynomial-time reductions concisely: definition, why they matter, one example.";
const RUNS = 5;
/** Conservative estimate ratio when exact provider tokens are unavailable. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const ctx = {
  message: PROMPT,
  topicId: "polynomial-reductions",
  level: "intermediate" as const,
  history: [],
};

const results: RunResult[] = [];

for (let i = 0; i < RUNS; i++) {
  const started = performance.now();
  let firstOutputAt: number | null = null;
  let charCount = 0;
  let usageTokens: number | null = null;
  const run: RunResult = {
    run: i + 1,
    ttftMs: null,
    totalMs: 0,
    streamingMs: null,
    tokens: 0,
    tokensEstimated: false,
    tokensPerSecond: null,
    errored: false,
    cancelled: false,
    timedOut: false,
  };
  try {
    const outcome = await streamWithFallback(ctx, {
      onDelta: (text) => {
        charCount += text.length;
        if (firstOutputAt === null) firstOutputAt = performance.now();
      },
    });
    if (outcome.usage?.outputTokens != null && outcome.usage.outputTokens > 0) {
      usageTokens = outcome.usage.outputTokens;
    }
    // Structured blocks (curated lessons / verified traces) also count as
    // output; their text feeds the token estimate when tokens are inexact.
    for (const block of outcome.reply.blocks) {
      const text = block.type === "text" || block.type === "callout" ? block.markdown : JSON.stringify(block);
      charCount += text.length;
    }
    // Providers that only complete in one shot (the curated fallback is not a
    // generative model) have no delta stream: first-output stays null and the
    // throughput column reports n/a rather than a fabricated rate.
  } catch (err) {
    run.errored = true;
    const message = err instanceof Error ? err.message : String(err);
    if (/aborted/i.test(message)) run.cancelled = true;
    if (/timed out/i.test(message)) run.timedOut = true;
    run.totalMs = performance.now() - started;
    results.push(run);
    continue;
  }

  const completed = performance.now();
  run.totalMs = completed - started;
  run.ttftMs = firstOutputAt !== null ? firstOutputAt - started : null;
  run.streamingMs = firstOutputAt !== null ? completed - firstOutputAt : null;
  // Usage metadata is delivered by the provider's final stream chunk; only the
  // exact count counts as exact. Otherwise fall back to a labelled estimate.
  const estimate = Math.round(charCount / CHARS_PER_TOKEN_ESTIMATE);
  run.tokensEstimated = usageTokens === null;
  run.tokens = run.tokensEstimated ? estimate : (usageTokens as number);
  run.tokensPerSecond =
    firstOutputAt !== null && run.streamingMs !== null && run.streamingMs > 0
      ? run.tokens / (run.streamingMs as number) * 1000
      : null;
  results.push(run);
}

const status = providerStatus();
const geminiActive = isGeminiEnabled();
const successful = results.filter((r) => !r.errored);
const med = {
  ttft: median(successful.map((r) => r.ttftMs ?? 0)),
  total: median(successful.map((r) => r.totalMs)),
  streaming: median(successful.map((r) => r.streamingMs ?? 0)),
  tps: median(successful.map((r) => r.tokensPerSecond ?? 0)),
};

console.log("=== AlgoTutor generation speed benchmark ===");
console.log(`provider selected: ${status.provider} (gemini active: ${geminiActive})`);
console.log(`model: ${config.ai.geminiModel}`);
console.log(`environment: node ${process.version}, ${process.platform}, NODE_ENV=${config.env}`);
console.log(`runs: ${RUNS}, prompt: <fixed benchmark prompt, a topic explanation>`);
console.log("");
for (const r of results) {
  const flags = [r.errored && "errored", r.cancelled && "cancelled", r.timedOut && "timeout"]
    .filter(Boolean)
    .join(",");
  console.log(
    `run ${r.run}: ttft=${r.ttftMs === null ? "n/a" : r.ttftMs.toFixed(0) + "ms"}` +
      ` total=${r.totalMs.toFixed(0)}ms` +
      ` streaming=${r.streamingMs === null ? "n/a" : r.streamingMs.toFixed(0) + "ms"}` +
      ` tokens=${r.tokens}${r.tokensEstimated ? " (estimate, ~4 chars/token)" : " (exact, provider usage)"}` +
      ` tps=${r.tokensPerSecond === null ? "n/a" : r.tokensPerSecond.toFixed(1)}` +
      (flags ? ` [${flags}]` : ""),
  );
}
console.log("");
console.log(
  `median: ttft=${med.ttft === null ? "n/a" : med.ttft.toFixed(0) + "ms"}` +
    ` total=${med.total === null ? "n/a" : med.total.toFixed(0) + "ms"}` +
    ` streaming=${med.streaming === null ? "n/a" : med.streaming.toFixed(0) + "ms"}` +
    ` output-throughput=${med.tps === null ? "n/a" : med.tps.toFixed(1) + " tokens/s"}`,
);
if (!geminiActive) {
  console.log("");
  console.log(
    "NOTE: the AI provider is not active, so the curated offline provider was measured. " +
      "It answers instantly from pre-written material; these numbers describe the curated path, " +
      "not generative model speed. Enable the AI provider under the documented compliance gate " +
      "and re-run this script to measure model throughput.",
  );
}
