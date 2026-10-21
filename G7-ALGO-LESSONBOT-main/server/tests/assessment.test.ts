/**
 * Assessment tests: generation, validation, grading, and exposure.
 *
 * Generation is tested through the REAL pipeline — the same validate, dedupe,
 * solver-check, distribute, and interleave code the route runs — with the
 * provider injected as a mock. No live call is made, so every assertion is
 * deterministic and the whole suite runs in milliseconds.
 *
 * The properties under test, in the order the requirements list them:
 *
 *   1. Exact counts  - 10/20/30/40/50 and nothing else, ever short, never
 *                      padded with filler.
 *   2. Coverage      - distribution computed from the real catalog, topics
 *                      interleaved rather than blocked.
 *   3. Validation    - schema, duplicates, answer sets, hints that give the
 *                      answer away, explanations that contradict the key.
 *   4. Solver truth  - a computed answer that disagrees with the solver is
 *                      rejected, not corrected.
 *   5. Bounds        - regeneration is capped; a failing provider cannot
 *                      become an unbounded retry loop.
 *   6. Honesty       - curated fallback only when the bank really can serve
 *                      the length, and labelled as such.
 *   7. Grading       - server-authoritative, idempotent, expiry-aware.
 *   8. Exposure      - the answer key never appears in a student payload.
 */
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { QUIZ_COUNTS } from "../../shared/contract.js";
import { listTopicSummaries } from "../src/data/topics.js";
import { quizBank } from "../src/data/quiz-bank.js";
import {
  MAX_BATCH_ATTEMPTS,
  generateAssessment,
  type QuestionProvider,
} from "../src/services/quizzes/generator.js";
import { planDistribution, interleave } from "../src/services/quizzes/distribution.js";
import {
  findDuplicatesAgainst,
  isNearDuplicate,
  normalizeText,
  validateQuestion,
} from "../src/services/quizzes/validate-questions.js";
import { verifyAgainstSolver } from "../src/services/quizzes/verify-solver.js";
import { runSolver } from "../src/services/algorithms/registry.js";
import {
  answerKeyDocument,
  clearAssessmentSessions,
  expireAssessment,
  getAssessmentSession,
  gradeAssessment,
  recordGrade,
  storeAssessment,
  studentQuestions,
  type StoredAssessmentQuestion,
} from "../src/services/quizzes/session-store.js";

const app = createApp();
const TOPIC_IDS = listTopicSummaries().map((t) => t.slug);

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

/**
 * Prompts chosen so that no two are near-duplicates of each other: the
 * dedupe check compares normalised token sets, so these deliberately share
 * very few words. Twelve of them covers the largest per-topic quota the
 * combined scope produces (50 questions / 5 topics = 10).
 */
const DISTINCT_STEMS: string[] = [
  "A polynomial-time reduction transforms one decision problem into another instance.",
  "Cook-Levin establishes NP-completeness by building a computation tableau from scratch.",
  "Vertex cover admits a greedy approximation with a proven performance guarantee.",
  "Randomized algorithms trade worst-case certainty for expected-case efficiency gains.",
  "Asymptotic notation describes how an algorithm consumes resources as input grows.",
  "Independent set resists efficient solution because brute force explores exponential configurations.",
  "Boolean satisfiability asks whether some assignment satisfies every clause of a formula.",
  "Approximation ratios quantify how close a heuristic result lands on the optimum.",
  "Turing machines formalise the limits of what any physical computer can compute.",
  "Decision problems expect a definitive yes-or-no verdict for each encoded instance.",
  "Karp reductions preserve answers while transforming instances in polynomial time.",
  "Worst-case analysis bounds the slowest execution path an algorithm can take.",
];

/**
 * A second stem pool, deliberately disjoint from the first.
 *
 * Prompts are built as "stem from A, then stem from B". Because the duplicate
 * check compares token SETS (order-insensitive), pairing two stems from the
 * same pool would make "X then Y" collide with "Y then X". Two separate
 * vocabularies make each pair unambiguous, so the fixture can produce as many
 * distinct prompts as any test needs.
 */
const SECONDARY_STEMS: string[] = [
  "Greedy choices local to each step do not always reach a global optimum.",
  "An approximation guarantee bounds the ratio against the best possible solution.",
  "Randomness can help a search escape from a repeated unlucky ordering.",
  "Reduction correctness needs both directions of the answer equivalence proved.",
  "Complexity classes group problems by the resources an algorithm actually needs.",
];

/** Choice texts chosen to appear in none of the stems above. */
const CHOICES = ["Option Alpha", "Option Beta", "Option Gamma", "Option Delta"];
const HINT = "Recall the definition the lesson gave for this idea.";

/**
 * Build a prompt that is genuinely distinct from every other one this
 * fixture produces.
 *
 * The deduplication check compares normalised token sets, so simply numbering
 * questions ("item 3" vs "item 4") reads as a near-duplicate — the token
 * overlap is far too high. Pairing a primary stem with a secondary one keeps
 * the shared fraction around 0.6–0.7, comfortably under the 0.85 threshold,
 * which lets the fixture supply the largest single-topic quota (50 questions)
 * without being (correctly) rejected as repetitive.
 */
function distinctStem(topicId: string, i: number): string {
  const g = topicIndex(topicId) * DISTINCT_STEMS.length + i;
  const a = DISTINCT_STEMS[g % DISTINCT_STEMS.length];
  const b = SECONDARY_STEMS[Math.floor(g / DISTINCT_STEMS.length) % SECONDARY_STEMS.length];
  return `${a} ${b}`;
}

/** A canonical graph whose cover size is read from the solver, never assumed. */
const VC_INPUT = {
  vertices: ["A", "B", "C", "D"],
  edges: [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
  ],
};
const COVER_SIZE = runSolver("vertex-cover-2approx", VC_INPUT).result.coverSize as number;

interface MockCall {
  topicId: string;
  quota: number;
  user: string;
}

function topicIndex(topicId: string): number {
  const i = TOPIC_IDS.indexOf(topicId);
  return i < 0 ? 0 : i;
}

function mcQuestion(topicId: string, i: number, extra: Record<string, unknown> = {}) {
  const stem = distinctStem(topicId, i);
  const answer = i % CHOICES.length;
  return {
    prompt: stem,
    kind: "multiple_choice",
    choices: CHOICES,
    answer,
    hint: HINT,
    difficulty: "medium",
    explanation: `The correct answer is ${CHOICES[answer]} because the lesson defines it that way.`,
    ...extra,
  };
}

function tfQuestion(topicId: string, i: number, extra: Record<string, unknown> = {}) {
  const stem = distinctStem(topicId, i);
  const answer = i % 2;
  return {
    prompt: stem,
    kind: "true_false",
    choices: ["True", "False"],
    answer,
    hint: HINT,
    difficulty: "medium",
    explanation: `This statement is ${answer === 0 ? "True" : "False"} as the lesson presents it.`,
    ...extra,
  };
}

/** A numerical question whose answer is the solver's own value. */
function numericalQuestion(i = 0, extra: Record<string, unknown> = {}) {
  return {
    prompt: `${distinctStem("approximation-algorithms", i)} What verified value does this imply for cover size?`,
    kind: "numerical",
    answer: COVER_SIZE,
    hint: HINT,
    difficulty: "medium",
    explanation: `The solver selects ${COVER_SIZE} vertices, so the cover size is ${COVER_SIZE}.`,
    verification: {
      solver: "vertex-cover-2approx",
      input: VC_INPUT,
      key: "coverSize",
      appliesTo: "answer",
    },
    ...extra,
  };
}

function makeProvider(
  reply: (call: MockCall, index: number) => string,
): QuestionProvider & { calls: MockCall[] } {
  const calls: MockCall[] = [];
  return {
    name: "mock",
    calls,
    async complete({ user }) {
      const quota = Number(/Write exactly (\d+) questions/.exec(user)?.[1] ?? 0);
      const topicId = /TOPIC: .+ \(([^)]+)\)/.exec(user)?.[1] ?? "unknown";
      const call: MockCall = { topicId, quota, user };
      calls.push(call);
      return reply(call, calls.length);
    },
  };
}

/** A well-behaved model: exactly the quota asked for, all valid. */
function goodProvider(): QuestionProvider & { calls: MockCall[] } {
  // Prompts must stay distinct ACROSS batches as well as within one: a long
  // single-topic paper is filled in several bounded passes, and a model that
  // restarted its numbering each pass would (correctly) be rejected as
  // repeating itself.
  const emitted = new Map<string, number>();
  return makeProvider((call) => {
    const start = emitted.get(call.topicId) ?? 0;
    emitted.set(call.topicId, start + call.quota);
    return JSON.stringify({
      questions: Array.from({ length: call.quota }, (_, i) => mcQuestion(call.topicId, start + i)),
    });
  });
}

function jsonOf(questions: unknown[]): string {
  return JSON.stringify({ questions });
}

// ---------------------------------------------------------------------------
// 1. Exact counts
// ---------------------------------------------------------------------------

describe("assessment generation produces exactly the requested length", () => {
  it.each(QUIZ_COUNTS)("builds a %i-question combined assessment", async (count) => {
    const outcome = await generateAssessment({ count }, goodProvider());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.questions).toHaveLength(count);
    expect(outcome.topicCoverage.reduce((n, c) => n + c.count, 0)).toBe(count);
  });

  it.each(QUIZ_COUNTS)("builds a %i-question single-topic assessment", async (count) => {
    const outcome = await generateAssessment({ count, topicId: "cook-levin" }, goodProvider());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.questions).toHaveLength(count);
    expect(outcome.scope).toBe("single");
  });

  it("issues a unique id for every question, with no repeats", async () => {
    const outcome = await generateAssessment({ count: 50 }, goodProvider());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const ids = outcome.questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(50);
  });

  it("discards a model-supplied id rather than trusting it", async () => {
    // A model that reuses one id would make two questions share an answer
    // slot and silently misgrade the paper. The server must own ids.
    const provider = makeProvider((call) =>
      jsonOf(
        Array.from({ length: call.quota }, (_, i) =>
          mcQuestion(call.topicId, i, { id: "forged-duplicate" }),
        ),
      ),
    );
    const outcome = await generateAssessment({ count: 10, topicId: "cook-levin" }, provider);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const ids = outcome.questions.map((q) => q.id);
    expect(ids).not.toContain("forged-duplicate");
    expect(new Set(ids).size).toBe(10);
  });

  it("never returns fewer questions than asked for", async () => {
    // The provider returns half of what was requested, every time.
    const provider = makeProvider((call) =>
      jsonOf(Array.from({ length: Math.ceil(call.quota / 2) }, (_, i) => mcQuestion(call.topicId, i))),
    );
    const outcome = await generateAssessment({ count: 10, topicId: "cook-levin" }, provider);
    // Either the exact count (curated bank topped it up) or an explicit
    // failure. Never a quiet 6-of-10.
    if (outcome.ok) expect(outcome.questions).toHaveLength(10);
    else expect(outcome.code).toBe("insufficient_content");
  });
});

// ---------------------------------------------------------------------------
// 2. Coverage and distribution
// ---------------------------------------------------------------------------

describe("coverage is computed from the real catalog", () => {
  it("combines every topic by default, evenly", async () => {
    const outcome = await generateAssessment({ count: 30 }, goodProvider());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.scope).toBe("combined");
    expect(outcome.topicCoverage.map((c) => c.topicId).sort()).toEqual([...TOPIC_IDS].sort());
    for (const entry of outcome.topicCoverage) expect(entry.count).toBe(6);
    // Coverage titles come from the catalog, not from a second hardcoded list.
    for (const entry of outcome.topicCoverage) expect(entry.title.length).toBeGreaterThan(0);
  });

  it("spreads a remainder across topics instead of piling it onto one", () => {
    const plan = planDistribution(23, TOPIC_IDS);
    const counts = plan.quotas.map((q) => q.count);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(23);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("interleaves topics so a combined paper is not five blocks", async () => {
    const outcome = await generateAssessment({ count: 30 }, goodProvider());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const firstFive = outcome.questions.slice(0, 5).map((q) => q.topicId);
    expect(new Set(firstFive).size).toBeGreaterThanOrEqual(4);
  });

  it("tags every question with the topic it actually came from", async () => {
    const outcome = await generateAssessment({ count: 20, topicId: "cook-levin" }, goodProvider());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    for (const q of outcome.questions) expect(q.topicId).toBe("cook-levin");
  });

  it("rejects an unknown topic with the real slugs attached", async () => {
    const outcome = await generateAssessment({ count: 10, topicId: "no-such-topic" }, goodProvider());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("topic_not_found");
    expect(outcome.message).toContain(TOPIC_IDS[0]);
  });

  it("interleave preserves every group's contents and order", () => {
    const out = interleave([
      ["a1", "a2", "a3"],
      ["b1", "b2"],
    ]);
    expect(out).toEqual(["a1", "b1", "a2", "b2", "a3"]);
  });
});

// ---------------------------------------------------------------------------
// 3. Validation
// ---------------------------------------------------------------------------

describe("question validation", () => {
  it("accepts a well-formed multiple-choice question", () => {
    const result = validateQuestion(mcQuestion("cook-levin", 0), "cook-levin", 0);
    expect(result.ok).toBe(true);
  });

  it("rejects a prompt too short to assess anything", () => {
    const result = validateQuestion(mcQuestion("cook-levin", 0, { prompt: "Too short?" }), "cook-levin", 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain("prompt_too_short");
  });

  it("rejects an unknown question kind", () => {
    const result = validateQuestion(mcQuestion("cook-levin", 0, { kind: "essay" }), "cook-levin", 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain("unknown_kind");
  });

  it("rejects duplicate choices, which make more than one option correct", () => {
    const result = validateQuestion(
      mcQuestion("cook-levin", 0, { choices: ["Same text", "Same text", "Third", "Fourth"] }),
      "cook-levin",
      0,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain("duplicate_choices");
  });

  it("rejects an answer index that points outside the choices", () => {
    const result = validateQuestion(mcQuestion("cook-levin", 0, { answer: 7 }), "cook-levin", 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain("answer_out_of_range");
  });

  it("rejects a true/false question that does not offer True and False", () => {
    const result = validateQuestion(
      tfQuestion("cook-levin", 0, { choices: ["Yes", "No"] }),
      "cook-levin",
      0,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain("true_false_choices");
  });

  it("rejects a hint that restates the correct choice", () => {
    const result = validateQuestion(
      mcQuestion("cook-levin", 0, { hint: `Think about ${CHOICES[0]} in particular.` }),
      "cook-levin",
      0,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain("hint_reveals_answer");
  });

  it("rejects a prompt that contains the correct choice's text", () => {
    const result = validateQuestion(
      mcQuestion("cook-levin", 0, { prompt: `${DISTINCT_STEMS[0]} Answer: ${CHOICES[0]}.` }),
      "cook-levin",
      0,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain("prompt_cues_answer");
  });

  it("rejects an explanation that discusses a wrong choice but never the right one", () => {
    const result = validateQuestion(
      mcQuestion("cook-levin", 0, { explanation: `${CHOICES[1]} would be right if the theorem were weaker.` }),
      "cook-levin",
      0,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain("explanation_contradicts_key");
  });

  it("rejects a question with no hint and no explanation", () => {
    const result = validateQuestion(
      mcQuestion("cook-levin", 0, { hint: "", explanation: "" }),
      "cook-levin",
      0,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.rejections.map((r) => r.code);
    expect(codes).toContain("hint_missing");
    expect(codes).toContain("explanation_missing");
  });

  it("reassigns the topic so a model cannot mislabel coverage", () => {
    const result = validateQuestion(mcQuestion("cook-levin", 0), "approximation-algorithms", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.question.topicId).toBe("approximation-algorithms");
  });
});

describe("duplicate and near-duplicate detection", () => {
  it("normalises case, spacing, and punctuation", () => {
    expect(normalizeText("  Vertex   Cover! ")).toBe("vertex cover");
    expect(isNearDuplicate("Vertex Cover is NP-hard.", "vertex   cover is np hard")).toBe(true);
  });

  it("treats a one-word rephrase as a duplicate", () => {
    expect(isNearDuplicate("What is NP-completeness?", "What is NP-completeness exactly?")).toBe(true);
  });

  it("leaves genuinely different questions alone", () => {
    expect(isNearDuplicate(DISTINCT_STEMS[0], DISTINCT_STEMS[7])).toBe(false);
  });

  it("reports which earlier prompts a new one duplicates", () => {
    const dupes = findDuplicatesAgainst(DISTINCT_STEMS[2], [DISTINCT_STEMS[5], DISTINCT_STEMS[2]]);
    expect(dupes).toEqual([DISTINCT_STEMS[2]]);
  });

  it("drops a repeated question inside one batch instead of publishing it twice", async () => {
    // The provider can only produce two distinct prompts, and the combined
    // scope asks for exactly two per topic — so this must succeed with no
    // prompt appearing twice, not quietly publish duplicates.
    const provider = makeProvider((call) =>
      jsonOf(Array.from({ length: call.quota }, (_, i) => mcQuestion(call.topicId, i % 2))),
    );
    const outcome = await generateAssessment({ count: 10 }, provider);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.questions).toHaveLength(10);
    const prompts = outcome.questions.map((q) => normalizeText(q.prompt));
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it("survives a provider that returns the same question over and over", async () => {
    const provider = makeProvider((call) =>
      jsonOf(Array.from({ length: call.quota }, () => mcQuestion(call.topicId, 0))),
    );
    const outcome = await generateAssessment({ count: 10 }, provider);
    // Either an honest failure, or a paper in which nothing repeats.
    if (outcome.ok) {
      const prompts = outcome.questions.map((q) => normalizeText(q.prompt));
      expect(new Set(prompts).size).toBe(prompts.length);
    } else {
      expect(outcome.code).toBe("insufficient_content");
    }
  });

  it("drops a question that repeats under a DIFFERENT topic", async () => {
    // The model ignores the topic and returns identical prompts for every
    // one. De-duplication has to be global: a student must not see the same
    // question twice just because it surfaced under two headings.
    const provider = makeProvider((call) =>
      jsonOf(Array.from({ length: call.quota }, (_, i) => mcQuestion(TOPIC_IDS[0], i))),
    );
    const outcome = await generateAssessment({ count: 10 }, provider);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const prompts = outcome.questions.map((q) => normalizeText(q.prompt));
    expect(new Set(prompts).size).toBe(prompts.length);
    // At most one AI-generated question survives, because only the first
    // topic's copy is accepted; the rest come from the bank.
    expect(outcome.source).toBe("mixed");
  });
});

// ---------------------------------------------------------------------------
// 4. Solver truth
// ---------------------------------------------------------------------------

describe("computed answers are checked against the solver", () => {
  it("accepts a numerical question whose answer matches the solver", () => {
    const check = verifyAgainstSolver(
      {
        solver: "vertex-cover-2approx",
        input: VC_INPUT,
        key: "coverSize",
        appliesTo: "answer",
      },
      COVER_SIZE,
    );
    expect(check.status).toBe("verified");
  });

  it("reports a disagreement rather than adopting the model's number", () => {
    const check = verifyAgainstSolver(
      { solver: "vertex-cover-2approx", input: VC_INPUT, key: "coverSize", appliesTo: "answer" },
      COVER_SIZE + 5,
    );
    expect(check.status).toBe("mismatch");
    if (check.status !== "mismatch") return;
    expect(check.value).toBe(COVER_SIZE);
    expect(check.expected).toBe(COVER_SIZE + 5);
  });

  it("reports an unusable verification block as unverifiable", () => {
    const check = verifyAgainstSolver(
      { solver: "no-such-solver", input: {}, key: "coverSize", appliesTo: "answer" },
      3,
    );
    expect(check.status).toBe("unverifiable");
  });

  it("reports a missing result key as unverifiable", () => {
    const check = verifyAgainstSolver(
      { solver: "vertex-cover-2approx", input: VC_INPUT, key: "nope", appliesTo: "answer" },
      3,
    );
    expect(check.status).toBe("unverifiable");
  });

  it("publishes a solver-verified question inside a full assessment", async () => {
    const provider = makeProvider((call) =>
      jsonOf(Array.from({ length: call.quota }, (_, i) => numericalQuestion(i))),
    );
    const outcome = await generateAssessment({ count: 10, topicId: "approximation-algorithms" }, provider);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.questions).toHaveLength(10);
    for (const q of outcome.questions) expect(q.answer).toBe(COVER_SIZE);
  });

  it("rejects a computed value the solver contradicts", async () => {
    const provider = makeProvider(() => jsonOf([numericalQuestion(0, { answer: COVER_SIZE + 5 })]));
    const outcome = await generateAssessment({ count: 10, topicId: "approximation-algorithms" }, provider);
    // The bad question is dropped; the paper is either topped up from the
    // bank or fails honestly. It is never published with a wrong number.
    if (outcome.ok) {
      for (const q of outcome.questions) {
        if (q.kind === "numerical") expect(q.answer).toBe(COVER_SIZE);
      }
    } else {
      expect(outcome.code).toBe("insufficient_content");
    }
  });

  it("rejects an unverifiable verification block", async () => {
    const provider = makeProvider(() =>
      jsonOf([
        numericalQuestion(0, {
          verification: { solver: "ghost", input: {}, key: "x", appliesTo: "answer" },
        }),
      ]),
    );
    const outcome = await generateAssessment({ count: 10, topicId: "approximation-algorithms" }, provider);
    if (outcome.ok) {
      expect(outcome.questions.some((q) => q.kind === "numerical")).toBe(false);
    } else {
      expect(outcome.ok).toBe(false);
    }
  });

  it("rejects a computed claim that carries no verification at all", async () => {
    // "cover size" is a solver-computable quantity; publishing it unchecked
    // would present a model guess as a verified fact.
    const provider = makeProvider(() =>
      jsonOf([
        {
          prompt: "What cover size does the greedy rule return on the four-vertex path?",
          kind: "numerical",
          answer: 3,
          hint: HINT,
          difficulty: "medium",
          explanation: "The greedy rule returns three vertices for this path graph.",
        },
      ]),
    );
    const outcome = await generateAssessment({ count: 10, topicId: "approximation-algorithms" }, provider);
    if (outcome.ok) {
      expect(outcome.questions.some((q) => q.prompt.includes("cover size"))).toBe(false);
    } else {
      expect(outcome.ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Bounds
// ---------------------------------------------------------------------------

describe("regeneration is bounded", () => {
  it("stops asking after a bounded number of attempts per topic", async () => {
    const provider = makeProvider(() => "this is not json at all");
    await generateAssessment({ count: 10, topicId: "cook-levin" }, provider);
    expect(provider.calls.length).toBeLessThanOrEqual(MAX_BATCH_ATTEMPTS);
    expect(MAX_BATCH_ATTEMPTS).toBeLessThanOrEqual(5);
  });

  it("bounds the attempts for a combined assessment too", async () => {
    const provider = makeProvider(() => "not json");
    await generateAssessment({ count: 10 }, provider);
    expect(provider.calls.length).toBeLessThanOrEqual(MAX_BATCH_ATTEMPTS * TOPIC_IDS.length);
  });

  it("stops retrying as soon as the quota is met", async () => {
    const provider = goodProvider();
    await generateAssessment({ count: 10, topicId: "cook-levin" }, provider);
    expect(provider.calls).toHaveLength(1);
  });

  it("asks for only the shortfall on a retry, not the whole batch again", async () => {
    let first = true;
    const provider = makeProvider((call) => {
      if (first) {
        first = false;
        return jsonOf([mcQuestion(call.topicId, 0)]);
      }
      return jsonOf(Array.from({ length: call.quota }, (_, i) => mcQuestion(call.topicId, i + 1)));
    });
    await generateAssessment({ count: 10, topicId: "cook-levin" }, provider);
    expect(provider.calls.length).toBeGreaterThanOrEqual(2);
    // Second call asks for what is still missing, not the original 10.
    expect(provider.calls[1].quota).toBeLessThan(provider.calls[0].quota);
  });

  it("feeds the specific rejections back into the retry", async () => {
    let first = true;
    const provider = makeProvider((call) => {
      if (first) {
        first = false;
        return jsonOf([mcQuestion(call.topicId, 0, { choices: ["Same", "Same"] })]);
      }
      return jsonOf(Array.from({ length: call.quota }, (_, i) => mcQuestion(call.topicId, i + 1)));
    });
    await generateAssessment({ count: 10, topicId: "cook-levin" }, provider);
    expect(provider.calls.length).toBeGreaterThanOrEqual(2);
    // A retry that re-sends the identical prompt gets the identical
    // rejection, so the second prompt must differ and must name the problem.
    expect(provider.calls[1].user).not.toBe(provider.calls[0].user);
    expect(provider.calls[1].user).toMatch(/rejected/i);
  });
});

// ---------------------------------------------------------------------------
// 6. Honesty: fallback, labelling, and explicit failure
// ---------------------------------------------------------------------------

describe("provider failure falls back honestly", () => {
  it("falls back to the curated bank when the provider is unavailable", async () => {
    const outcome = await generateAssessment({ count: 10 }, null);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.questions).toHaveLength(10);
    expect(outcome.source).toBe("curated");
  });

  it("labels a mixed paper as mixed, never as fully AI-generated", async () => {
    // The provider yields one question per topic; the bank fills the rest.
    const provider = makeProvider((call) => jsonOf([mcQuestion(call.topicId, 0)]));
    const outcome = await generateAssessment({ count: 10 }, provider);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.source).toBe("mixed");
    expect(outcome.notes.length).toBeGreaterThan(0);
  });

  it("labels a provider-driven paper as ai-generated", async () => {
    const outcome = await generateAssessment({ count: 10 }, goodProvider());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.source).toBe("ai");
  });

  it("reports a provider that throws instead of retrying forever", async () => {
    const provider = makeProvider(() => {
      throw new Error("upstream 500");
    });
    const outcome = await generateAssessment({ count: 10 }, provider);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // One call per topic, then the bank. No retry spiral against a hard error.
    expect(provider.calls).toHaveLength(TOPIC_IDS.length);
    expect(outcome.source).toBe("curated");
    expect(outcome.notes.join(" ")).toMatch(/upstream 500|curated/i);
  });

  it("fails explicitly when the bank cannot serve the length", async () => {
    // The bank holds 30 questions in total, so 40 is impossible without a
    // provider. Silently returning 30 would be worse than saying no.
    const outcome = await generateAssessment({ count: 40 }, null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("insufficient_content");
    expect(outcome.message).toContain("40");
  });

  it("fails explicitly for 50 questions without a provider", async () => {
    const outcome = await generateAssessment({ count: 50 }, null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("insufficient_content");
  });

  it("refuses a true/false paper from a bank that has no true/false items", async () => {
    const outcome = await generateAssessment({ count: 10, format: "true_false" }, null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("insufficient_content");
  });

  it("respects the requested format rather than substituting another one", async () => {
    const outcome = await generateAssessment({ count: 10, format: "multiple_choice" }, null);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    for (const q of outcome.questions) expect(q.kind).toBe("multiple_choice");
  });

  it("generates a true/false paper when the provider can supply one", async () => {
    const provider = makeProvider((call) =>
      jsonOf(Array.from({ length: call.quota }, (_, i) => tfQuestion(call.topicId, i))),
    );
    const outcome = await generateAssessment({ count: 10, topicId: "cook-levin", format: "true_false" }, provider);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.questions).toHaveLength(10);
    for (const q of outcome.questions) {
      expect(q.kind).toBe("true_false");
      // Every true/false item offers exactly True and False, and the key
      // points at one of them.
      expect(q.choices).toEqual(["True", "False"]);
      expect(q.answer === 0 || q.answer === 1).toBe(true);
    }
  });

  it("the bank genuinely cannot satisfy more than 30 questions", () => {
    const total = Object.values(quizBank).reduce((n, qs) => n + qs.length, 0);
    expect(total).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Malformed provider output
// ---------------------------------------------------------------------------

describe("malformed provider output is rejected, not published", () => {
  it.each([
    ["invalid JSON", "definitely not json"],
    ["no questions array", JSON.stringify({ items: [] })],
    ["an empty batch", JSON.stringify({ questions: [] })],
  ])("handles %s", async (_label, raw) => {
    const provider = makeProvider(() => raw);
    const outcome = await generateAssessment({ count: 10, topicId: "cook-levin" }, provider);
    // Either topped up from the bank or an honest failure — never a
    // half-parsed paper.
    if (outcome.ok) {
      expect(outcome.questions).toHaveLength(10);
      expect(outcome.source).not.toBe("ai");
    } else {
      expect(outcome.code).toBe("insufficient_content");
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Grading (session store)
// ---------------------------------------------------------------------------

function storedFixture(count = 4): { questions: StoredAssessmentQuestion[] } {
  const questions: StoredAssessmentQuestion[] = Array.from({ length: count }, (_, i) => ({
    id: `q-${i}`,
    topicId: i % 2 === 0 ? "cook-levin" : "approximation-algorithms",
    prompt: DISTINCT_STEMS[i],
    kind: "multiple_choice",
    choices: CHOICES,
    hint: HINT,
    difficulty: "medium",
    answer: i % CHOICES.length,
    explanation: `The correct answer is ${CHOICES[i % CHOICES.length]}.`,
  }));
  return { questions };
}

function storeFixture(count = 4) {
  const { questions } = storedFixture(count);
  return storeAssessment({
    title: "Fixture quiz",
    scope: "combined",
    count: count as 10,
    difficulty: "mixed",
    format: "mixed",
    source: "curated",
    topicCoverage: [
      { topicId: "cook-levin", title: "Cook-Levin", count: count / 2 },
      { topicId: "approximation-algorithms", title: "Approximation", count: count / 2 },
    ],
    questions,
  });
}

describe("server-authoritative grading", () => {
  beforeEach(() => clearAssessmentSessions());

  it("awards full marks for a fully correct submission", () => {
    const session = storeFixture();
    const answers = Object.fromEntries(session.questions.map((q) => [q.id, q.answer]));
    const result = gradeAssessment(session, answers);
    expect(result.correct).toBe(4);
    expect(result.score).toBe(4);
    expect(result.percentage).toBe(100);
    expect(result.incorrect).toBe(0);
    expect(result.unanswered).toBe(0);
  });

  it("reports blanks as unanswered, separately from wrong answers", () => {
    const session = storeFixture();
    const answers: Record<string, number | null> = {
      [session.questions[0].id]: session.questions[0].answer,
      [session.questions[1].id]: (session.questions[1].answer + 1) % 4,
      // The remaining two are left blank.
    };
    const result = gradeAssessment(session, answers);
    expect(result.correct).toBe(1);
    expect(result.incorrect).toBe(1);
    expect(result.unanswered).toBe(2);
    expect(result.total).toBe(4);
    expect(result.results.filter((r) => r.unanswered)).toHaveLength(2);
  });

  it("treats a null answer as blank and a wrong index as wrong", () => {
    const session = storeFixture();
    const result = gradeAssessment(session, { [session.questions[0].id]: null });
    expect(result.results[0].unanswered).toBe(true);
    expect(result.results[0].correct).toBe(false);
  });

  it("cannot be moved by answers for questions that are not in the paper", () => {
    const session = storeFixture();
    const answers: Record<string, number | null> = Object.fromEntries(
      session.questions.map((q) => [q.id, q.answer]),
    );
    answers["not-a-real-question"] = 3;
    expect(gradeAssessment(session, answers).score).toBe(4);
  });

  it("summarises performance per topic", () => {
    const session = storeFixture();
    // Correct on both cook-levin questions, wrong on both approximation ones.
    const answers: Record<string, number | null> = {};
    for (const q of session.questions) {
      answers[q.id] = q.topicId === "cook-levin" ? q.answer : (q.answer + 1) % 4;
    }
    const result = gradeAssessment(session, answers);
    const byId = Object.fromEntries(result.topicBreakdown.map((t) => [t.topicId, t]));
    expect(byId["cook-levin"].correct).toBe(2);
    expect(byId["cook-levin"].count).toBe(2);
    expect(byId["approximation-algorithms"].correct).toBe(0);
  });

  it("grades an exact numerical match correct and an off-by-a-hair one wrong", () => {
    const questions: StoredAssessmentQuestion[] = [
      {
        id: "num-1",
        topicId: "cook-levin",
        prompt: "How many variables does the encoding use?",
        kind: "numerical",
        choices: null,
        hint: HINT,
        difficulty: "medium",
        answer: 12,
        explanation: "The encoding uses twelve variables.",
      },
    ];
    const session = storeAssessment({
      title: "Numerical",
      scope: "single",
      count: 10,
      difficulty: "mixed",
      format: "mixed",
      source: "curated",
      topicCoverage: [{ topicId: "cook-levin", title: "Cook-Levin", count: 1 }],
      questions,
    });
    expect(gradeAssessment(session, { "num-1": 12 }).correct).toBe(1);
    // Inside the display-rounding tolerance.
    expect(gradeAssessment(session, { "num-1": 12.0000001 }).correct).toBe(1);
    // Outside it.
    expect(gradeAssessment(session, { "num-1": 12.001 }).correct).toBe(0);
  });

  it("records a grade exactly once and replays the first result", () => {
    const session = storeFixture();
    const first = recordGrade(session, gradeAssessment(session, { [session.questions[0].id]: 0 }));
    const again = recordGrade(session, gradeAssessment(session, {}));
    expect(again).toBe(first);
    expect(session.result?.score).toBe(first.score);
  });

  it("exposes no answer or explanation in the student view", () => {
    const session = storeFixture();
    const view = studentQuestions(session);
    expect(view).toHaveLength(4);
    for (const q of view) {
      expect(q).not.toHaveProperty("answer");
      expect(q).not.toHaveProperty("explanation");
      expect(q).toHaveProperty("prompt");
      expect(q).toHaveProperty("choices");
    }
    // And none of the key text leaks through the serialised form either.
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("The correct answer is");
  });

  it("numbers the answer key sequentially and includes the answers", () => {
    const session = storeFixture();
    const key = answerKeyDocument(session);
    expect(key.questions.map((q) => q.number)).toEqual([1, 2, 3, 4]);
    expect(key.questions[0].answer).toBe(session.questions[0].answer);
    expect(key.questions[0].explanation.length).toBeGreaterThan(0);
    expect(key.questions[0].answerText).toBe(CHOICES[session.questions[0].answer]);
  });

  it("returns an unguessable session id", () => {
    const ids = new Set(Array.from({ length: 25 }, () => storeFixture().meta.id));
    expect(ids.size).toBe(25);
    for (const id of ids) expect(id).toMatch(/^asmt-[0-9a-f-]{36}$/);
  });

  it("expires a session and stops serving it", () => {
    const session = storeFixture();
    expect(getAssessmentSession(session.meta.id)).toBeDefined();
    expireAssessment(session.meta.id);
    expect(getAssessmentSession(session.meta.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7b. Routes
// ---------------------------------------------------------------------------

describe("assessment routes", () => {
  beforeEach(() => clearAssessmentSessions());

  it("creates a 10-question assessment with keyless questions", async () => {
    const res = await request(app).post("/api/quizzes/assessment").send({ count: 10 });
    expect(res.status).toBe(200);
    expect(res.body.assessment.count).toBe(10);
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.assessment.source).toBe("curated");
    for (const q of res.body.questions) {
      expect(q).not.toHaveProperty("answer");
      expect(q).not.toHaveProperty("explanation");
    }
  });

  it.each([7, 15, 0, 100, 51])("refuses the unsupported length %i", async (count) => {
    const res = await request(app).post("/api/quizzes/assessment").send({ count });
    expect(res.status).toBe(400);
  });

  it("refuses a missing count", async () => {
    const res = await request(app).post("/api/quizzes/assessment").send({});
    expect(res.status).toBe(400);
  });

  it("answers 404 for a topic that does not exist", async () => {
    const res = await request(app)
      .post("/api/quizzes/assessment")
      .send({ count: 10, topicId: "astrology" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("topic_not_found");
    expect(res.body.error.message).toContain(TOPIC_IDS[0]);
  });

  it("answers 422 for a length the content cannot support, and says retrying will not help", async () => {
    const res = await request(app).post("/api/quizzes/assessment").send({ count: 40 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("insufficient_content");
    expect(res.body.error.details.requestedCount).toBe(40);
    expect(res.body.error.details.providerAvailable).toBe(false);
    expect(res.body.error.details.retryable).toBe(false);
  });

  it("grades a submission against the stored key and never exposes it early", async () => {
    const created = await request(app).post("/api/quizzes/assessment").send({ count: 10 });
    const id = created.body.assessment.id;
    const questions = created.body.questions;
    // The student payload has no key to read, so the test has to fetch it the
    // way an instructor would — by the explicit action.
    const key = await request(app).get(`/api/quizzes/assessment/${id}/key`);
    expect(key.status).toBe(200);
    const answers = Object.fromEntries(
      key.body.questions.map((q: { id: string; answer: number }) => [q.id, q.answer]),
    );

    const submitted = await request(app)
      .post(`/api/quizzes/assessment/${id}/submit`)
      .send({ assessmentId: id, answers });
    expect(submitted.status).toBe(200);
    expect(submitted.body.correct).toBe(10);
    expect(submitted.body.percentage).toBe(100);
    expect(submitted.body.results).toHaveLength(10);
    for (const r of submitted.body.results) expect(r.correct).toBe(true);
  });

  it("grades a blank submission as entirely unanswered, not as zero-correct-wrong", async () => {
    const created = await request(app).post("/api/quizzes/assessment").send({ count: 10 });
    const id = created.body.assessment.id;
    const res = await request(app)
      .post(`/api/quizzes/assessment/${id}/submit`)
      .send({ assessmentId: id, answers: {} });
    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(0);
    expect(res.body.unanswered).toBe(10);
    expect(res.body.incorrect).toBe(0);
    expect(res.body.percentage).toBe(0);
  });

  it("replays the stored result on a duplicate submission", async () => {
    const created = await request(app).post("/api/quizzes/assessment").send({ count: 10 });
    const id = created.body.assessment.id;
    const key = await request(app).get(`/api/quizzes/assessment/${id}/key`);
    const answers = Object.fromEntries(
      key.body.questions.map((q: { id: string; answer: number }) => [q.id, q.answer]),
    );
    const first = await request(app)
      .post(`/api/quizzes/assessment/${id}/submit`)
      .send({ assessmentId: id, answers });
    // A second submit, with DIFFERENT answers, must not change the score.
    const second = await request(app)
      .post(`/api/quizzes/assessment/${id}/submit`)
      .send({ assessmentId: id, answers: {} });
    expect(second.body.alreadySubmitted).toBe(true);
    expect(second.body.score).toBe(first.body.score);
    expect(second.body.percentage).toBe(first.body.percentage);
  });

  it("rejects a submission whose path and body ids disagree", async () => {
    const created = await request(app).post("/api/quizzes/assessment").send({ count: 10 });
    const id = created.body.assessment.id;
    const res = await request(app)
      .post(`/api/quizzes/assessment/${id}/submit`)
      .send({ assessmentId: "asmt-someone-else", answers: {} });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("id_mismatch");
  });

  it("reloads an active session without its key", async () => {
    const created = await request(app).post("/api/quizzes/assessment").send({ count: 10 });
    const id = created.body.assessment.id;
    const res = await request(app).get(`/api/quizzes/assessment/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.alreadySubmitted).toBe(false);
    for (const q of res.body.questions) expect(q).not.toHaveProperty("answer");
  });

  it("says so plainly once a session has expired", async () => {
    const created = await request(app).post("/api/quizzes/assessment").send({ count: 10 });
    const id = created.body.assessment.id;
    expireAssessment(id);

    const reload = await request(app).get(`/api/quizzes/assessment/${id}`);
    expect(reload.status).toBe(410);
    expect(reload.body.error.code).toBe("assessment_expired");

    const submit = await request(app)
      .post(`/api/quizzes/assessment/${id}/submit`)
      .send({ assessmentId: id, answers: {} });
    expect(submit.status).toBe(410);

    const key = await request(app).get(`/api/quizzes/assessment/${id}/key`);
    expect(key.status).toBe(410);
  });

  it("answers 410 for a session the server never knew", async () => {
    const res = await request(app).get("/api/quizzes/assessment/asmt-00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(410);
  });

  it("never leaks the answer key into a normal question payload", async () => {
    const created = await request(app).post("/api/quizzes/assessment").send({ count: 10 });
    const body = JSON.stringify(created.body);
    const key = await request(app).get(`/api/quizzes/assessment/${created.body.assessment.id}/key`);

    // The choice texts themselves must appear — the student has to see the
    // options. What must NOT appear is anything that identifies WHICH one is
    // correct: no answer index, no explanation, no answer text field.
    for (const q of created.body.questions as Record<string, unknown>[]) {
      expect(q).not.toHaveProperty("answer");
      expect(q).not.toHaveProperty("explanation");
      expect(q).not.toHaveProperty("answerText");
      expect(q).not.toHaveProperty("rationale");
    }
    expect(body).not.toContain("answerText");
    // The explanations the key carries are absent from the student payload.
    for (const q of key.body.questions as { explanation: string }[]) {
      expect(body).not.toContain(q.explanation);
    }
  });

  it("keeps the legacy practice-quiz routes working", async () => {
    const gen = await request(app)
      .post("/api/quizzes/generate")
      .send({ topicId: "cook-levin", count: 3 });
    expect(gen.status).toBe(200);
    expect(gen.body.quiz.questions).toHaveLength(3);
    const graded = await request(app)
      .post("/api/quizzes/grade")
      .send({ quizId: gen.body.quiz.id, answers: { [gen.body.quiz.questions[0].id]: 0 } });
    expect(graded.status).toBe(200);
    expect(graded.body.total).toBe(3);
  });
});
