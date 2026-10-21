/**
 * Curated worked examples. Each entry pairs a solver input with the lesson
 * narrative. The solver computes every numerical result; these entries only
 * supply the reviewed inputs and the surrounding explanation.
 */
import type { AlgorithmTrace, SolverResult } from "../../../../shared/contract.js";

export interface CuratedExample {
  id: string;
  topicId: string;
  solverId: string;
  title: string;
  prompt: string;
  input: Record<string, unknown>;
  narrative: string[];
}

export const curatedExamples: CuratedExample[] = [
  {
    id: "ex-reduction-p4",
    topicId: "formal-reductions",
    solverId: "reduction-is-to-vc",
    title: "Independent Set → Vertex Cover on a 4-vertex path",
    prompt: "Show a Vertex Cover example",
    input: {
      vertices: ["A", "B", "C", "D"],
      edges: [
        ["A", "B"],
        ["B", "C"],
        ["C", "D"],
      ],
      k: 2,
    },
    narrative: [
      "This is the canonical reduction: keep the graph, map k ↦ n − k.",
      "The solver verifies the complement duality on this exact instance.",
    ],
  },
  {
    id: "ex-reduction-triangle",
    topicId: "formal-reductions",
    solverId: "reduction-is-to-vc",
    title: "Independent Set → Vertex Cover on a triangle",
    prompt: "Give another reduction example",
    input: {
      vertices: ["A", "B", "C"],
      edges: [
        ["A", "B"],
        ["B", "C"],
        ["A", "C"],
      ],
      k: 1,
    },
    narrative: [
      "On a triangle, the largest independent set has size 1, so the Vertex Cover instance asks for a cover of size n − k = 2.",
      "The solver finds a witness independent set and checks its complement is a cover.",
    ],
  },
  {
    id: "ex-cook-levin",
    topicId: "cook-levin",
    solverId: "cook-levin-tableau",
    title: "Cook–Levin tableau for a fixed 3-state machine",
    prompt: "Explain Cook–Levin simply",
    input: {
      machine: {
        states: ["q0", "q1", "qacc"],
        alphabet: ["0", "1", "_"],
        startState: "q0",
        acceptState: "qacc",
        transitions: [
          { from: "q0", read: "0", to: "q1", write: "1", move: "R" },
          { from: "q1", read: "1", to: "qacc", write: "1", move: "R" },
          { from: "q0", read: "1", to: "q0", write: "1", move: "L" },
        ],
      },
      input: "01",
      steps: 3,
    },
    narrative: [
      "The machine scans '01', writes a 1, moves right, and reaches the accepting state within 3 steps.",
      "The solver builds the exact CNF encoding: one variable per (time, cell, symbol) and per (time, cell, state), plus initial, accepting, and window-consistency clauses.",
    ],
  },
  {
    id: "ex-vertex-cover",
    topicId: "approximation-algorithms",
    solverId: "vertex-cover-2approx",
    title: "2-approximation Vertex Cover on a 4-vertex path",
    prompt: "Run a Vertex Cover example",
    input: {
      vertices: ["A", "B", "C", "D"],
      edges: [
        ["A", "B"],
        ["B", "C"],
        ["C", "D"],
      ],
    },
    narrative: [
      "The algorithm picks uncovered edges in sorted order and adds both endpoints.",
      "The picked edges form a matching, which drives the 2·OPT guarantee.",
    ],
  },
  {
    id: "ex-max-cut",
    topicId: "randomized-algorithms",
    solverId: "randomized-max-cut",
    title: "Randomized Max-Cut with a fixed seed",
    prompt: "Run a randomized Max-Cut demo",
    input: {
      vertices: ["A", "B", "C", "D"],
      edges: [
        ["A", "B"],
        ["A", "C"],
        ["B", "C"],
        ["B", "D"],
        ["C", "D"],
      ],
      seed: 42,
      trials: 5,
    },
    narrative: [
      "Each trial flips a fair seeded coin per vertex and counts the cut edges.",
      "The theoretical expectation is E[cut] = m/2 = 2.5; the seeded trials are one reproducible sample.",
    ],
  },
];

export function getExample(id: string): CuratedExample | undefined {
  return curatedExamples.find((e) => e.id === id);
}

export function examplesForTopic(topicId: string): CuratedExample[] {
  return curatedExamples.filter((e) => e.topicId === topicId);
}

/** Regexes that identify a specific algorithm named inside the student's message. */
const ALGORITHM_KEYWORDS: { re: RegExp; solverId: string }[] = [
  { re: /max[- ]?cut/i, solverId: "randomized-max-cut" },
  { re: /cook[-\s]?levin|tableau/i, solverId: "cook-levin-tableau" },
  { re: /vertex[: ]?cover/i, solverId: "vertex-cover-2approx" },
  { re: /\breduction\b|independent set|≤\s?p\b|leq_?p/i, solverId: "reduction-is-to-vc" },
];

export interface ComputationIntent {
  /** The example whose solver should run, matched from the message or topic. */
  example: CuratedExample;
  /** True when the message explicitly names the algorithm (strong evidence). */
  explicit: boolean;
}

/** Wording that indicates the student wants to SEE a computation. */
const ACTION_RE =
  /\bexample\b|\bdemo\b|\btrace\b|\bwalk ?through\b|\brun\b|\bsolve\b|\bcompute\b|\bshow\b|\bsimply\b/i;

/**
 * Decide whether the student's message asks for a computed example, and which
 * solver should run. Message keywords win over the selected topic because the
 * topic selector is a global default — a student typing "run a Max-Cut demo"
 * while any topic is selected means Max-Cut, never the topic's default example.
 */
/**
 * Typographic dashes the product's own copy uses in algorithm names
 * ("Cook–Levin", "Max–Cut" — en dash U+2013 and friends). Matching runs on
 * text where these are folded to a plain hyphen, so the keyword regexes above
 * (which accept an ASCII hyphen or a space) see the name they expect.
 */
const DASHES = /[\u2010-\u2015\u2212]/g;

export function resolveComputation(
  message: string,
  topicId: string | null,
): ComputationIntent | undefined {
  const text = message.toLowerCase().replace(DASHES, "-");

  // Explicit algorithm keyword PLUS action wording ("run a Max-Cut demo").
  // Naming an algorithm alone ("explain polynomial reductions") is not a
  // computation request.
  const algorithmKeyword = ALGORITHM_KEYWORDS.find((m) => m.re.test(text));
  if (algorithmKeyword && ACTION_RE.test(text)) {
    // Prefer an example for the selected topic that uses the named algorithm;
    // otherwise use the canonical curated example for that algorithm.
    const example =
      (topicId && examplesForTopic(topicId).find((e) => e.solverId === algorithmKeyword.solverId)) ??
      curatedExamples.find((e) => e.solverId === algorithmKeyword.solverId);
    if (example) return { example, explicit: true };
  }

  // Generic "show/run/solve/example/demo" wording: use the selected topic's
  // FIRST curated example. Never substitute another topic's example here.
  if (ACTION_RE.test(text)) {
    const topicExamples = topicId ? examplesForTopic(topicId) : [];
    if (topicExamples.length > 0) return { example: topicExamples[0], explicit: false };
  }

  return undefined;
}

/** Convert a SolverResult into the trace block shape used in chat. */
export function traceFromResult(result: SolverResult): AlgorithmTrace {
  return {
    algorithmId: result.algorithmId,
    algorithmName: result.algorithmName,
    title: result.algorithmName,
    steps: result.steps,
    result: result.result,
    complexity: result.complexity,
    guarantee: result.guarantee,
    seed: result.seed,
    warnings: result.warnings,
  };
}
