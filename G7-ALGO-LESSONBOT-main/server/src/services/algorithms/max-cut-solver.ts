/**
 * Solver: randomized Max-Cut with a seedable generator (Topic 5).
 *
 * Each trial assigns every vertex to side A or B with probability 1/2 using
 * the seeded generator, then counts the cut edges. The seed makes the trial
 * sequence reproducible for teaching. The expectation E[cut] = m/2 is a
 * theoretical statement over all 2^n assignments — the seeded trials are one
 * reproducible sample, not all possible runs.
 */
import type { SolverResult, TraceStep } from "../../../../shared/contract.js";
import { LIMITS, RawGraph, toGraphData, validateGraph, edgeId, ValidationError } from "./graph-utils.js";
import { SeededRandom, validateSeed } from "./rng.js";

export interface MaxCutInput {
  vertices: string[];
  edges: [string, string][];
  seed: number;
  trials: number;
}

export function solveMaxCut(input: unknown): SolverResult {
  const parsed = input as MaxCutInput;
  const raw: RawGraph = validateGraph(parsed?.vertices, parsed?.edges);
  const seed = validateSeed(parsed?.seed);
  const trials = parsed?.trials;
  if (!Number.isInteger(trials) || trials < 1 || trials > LIMITS.maxTrials) {
    throw new ValidationError("invalid_trials", `trials must be an integer between 1 and ${LIMITS.maxTrials}.`);
  }

  const rng = new SeededRandom(seed);
  const m = raw.edges.length;
  const expected = m / 2;

  interface Trial {
    assignment: Record<string, "A" | "B">;
    cutEdges: string[];
    value: number;
  }
  const trialResults: Trial[] = [];
  const steps: TraceStep[] = [];

  steps.push({
    step: 1,
    title: "Set up the seeded experiment",
    description: `Graph with ${raw.vertices.length} vertices and ${m} edges. Each of the ${trials} trials flips a fair seeded coin per vertex (seed = ${seed}) and counts the cut edges. The theoretical expectation is E[cut] = m/2 = ${expected}.`,
    graph: toGraphData(raw, undefined, undefined, "grid"),
  });

  for (let t = 0; t < trials; t++) {
    const assignment: Record<string, "A" | "B"> = {};
    for (const v of raw.vertices) assignment[v] = rng.bit() === 0 ? "A" : "B";
    const cutEdges: string[] = [];
    for (const [a, b] of raw.edges) {
      if (assignment[a] !== assignment[b]) cutEdges.push(`${a}–${b}`);
    }
    trialResults.push({ assignment, cutEdges, value: cutEdges.length });
    const runningAvg = trialResults.reduce((s, r) => s + r.value, 0) / trialResults.length;
    steps.push({
      step: t + 2,
      title: `Trial ${t + 1}: assignment {${raw.vertices.map((v) => `${v}:${assignment[v]}`).join(", ")}}`,
      description: `${cutEdges.length} edge${cutEdges.length === 1 ? "" : "s"} cut (${cutEdges.join(", ") || "none"}). Running average: ${runningAvg.toFixed(2)}.`,
      graph: toGraphData(
        raw,
        (v) => (assignment[v] === "A" ? "side_a" : "side_b"),
        (a, b) => (assignment[a] !== assignment[b] ? "cut" : "uncut"),
        "grid",
        "straight",
      ),
      table: {
        columns: [
          { key: "trial", header: "Trial" },
          { key: "cut", header: "Cut value" },
          { key: "average", header: "Running average" },
        ],
        rows: [
          { trial: t + 1, cut: cutEdges.length, average: runningAvg.toFixed(2) },
        ],
      },
    });
  }

  const values = trialResults.map((r) => r.value);
  const best = trialResults.reduce((a, b) => (b.value > a.value ? b : a));
  const avg = values.reduce((s, v) => s + v, 0) / values.length;

  steps.push({
    step: trials + 2,
    title: "Accumulated statistics",
    description: `Over ${trials} seeded trials: average cut ${avg.toFixed(2)}, best ${best.value}, worst ${Math.min(...values)}. The theoretical expectation over all 2^${raw.vertices.length} assignments is E[cut] = m/2 = ${expected} ≥ OPT/2. The seeded trials are one reproducible sample — different seeds give different sequences, and a small number of trials need not average exactly ${expected}.`,
    graph: toGraphData(
      raw,
      (v) => (best.assignment[v] === "A" ? "side_a" : "side_b"),
      (a, b) => (best.assignment[a] !== best.assignment[b] ? "cut" : "uncut"),
      "grid",
    ),
    table: {
      columns: [
        { key: "statistic", header: "Statistic" },
        { key: "value", header: "Value" },
      ],
      rows: [
        { statistic: "Trials (seeded)", value: trials },
        { statistic: "Average cut", value: avg.toFixed(2) },
        { statistic: "Best cut", value: best.value },
        { statistic: "Worst cut", value: Math.min(...values) },
        { statistic: "Theoretical E[cut] = m/2", value: expected },
      ],
    },
  });

  return {
    algorithmId: "randomized-max-cut",
    algorithmName: "Randomized Max-Cut (seeded)",
    topicId: "randomized-algorithms",
    input: { vertices: raw.vertices, edges: raw.edges, seed, trials },
    steps,
    result: {
      seed,
      trials,
      averageCut: Number(avg.toFixed(4)),
      bestCut: best.value,
      bestAssignment: best.assignment,
      worstCut: Math.min(...values),
      expectedCut: expected,
    },
    complexity: { time: "O(trials · (n + m))", space: "O(n + m)" },
    guarantee: `E[cut] = m/2 = ${expected} ≥ OPT/2 (1/2-approximation in expectation). Seeded run is reproducible; it is one sample, not all runs.`,
    seed,
    warnings: [
      "A fixed seed shows one reproducible run, not all possible runs. The expectation statement is over all 2^n assignments.",
    ],
  };
}
