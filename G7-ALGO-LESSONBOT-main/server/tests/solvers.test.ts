/**
 * Solver tests: known answers, edge cases, invalid inputs, deterministic replay.
 * Run with: npm --prefix server test
 */
import { describe, expect, it } from "vitest";
import { solveReduction } from "../src/services/algorithms/reduction-solver.js";
import { solveVertexCover } from "../src/services/algorithms/vertex-cover-solver.js";
import { solveCookLevin } from "../src/services/algorithms/cook-levin-solver.js";
import { solveMaxCut } from "../src/services/algorithms/max-cut-solver.js";
import { ValidationError } from "../src/services/algorithms/graph-utils.js";

const path4 = {
  vertices: ["A", "B", "C", "D"],
  edges: [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
  ] as [string, string][],
};

describe("reduction solver (Independent Set ≤p Vertex Cover)", () => {
  it("maps the parameter k ↦ n − k", () => {
    const r = solveReduction({ ...path4, k: 2 });
    expect(r.result.targetParameter).toBe(2); // n=4, k=2 → n−k=2
    expect(r.result.sourceParameter).toBe(2);
  });

  it("finds a witness independent set and verifies its complement is a cover", () => {
    const r = solveReduction({ ...path4, k: 2 });
    const witness = r.result.witness as { independentSet: string[]; complementCover: string[] } | null;
    expect(witness).not.toBeNull();
    expect(witness!.independentSet.length).toBeGreaterThanOrEqual(2);
    // Complement must touch every edge.
    for (const [a, b] of path4.edges) {
      expect(witness!.complementCover.includes(a) || witness!.complementCover.includes(b)).toBe(true);
    }
  });

  it("handles k = 0 (trivial YES)", () => {
    const r = solveReduction({ ...path4, k: 0 });
    expect(r.result.targetParameter).toBe(4);
  });

  it("rejects invalid k", () => {
    expect(() => solveReduction({ ...path4, k: 5 })).toThrow(ValidationError);
    expect(() => solveReduction({ ...path4, k: -1 })).toThrow(ValidationError);
    expect(() => solveReduction({ ...path4, k: 1.5 })).toThrow(ValidationError);
  });

  it("rejects malformed graphs", () => {
    expect(() => solveReduction({ vertices: ["A", "A"], edges: [], k: 1 })).toThrow(ValidationError);
    expect(() => solveReduction({ vertices: ["A"], edges: [["A", "Z"]], k: 1 })).toThrow(ValidationError);
    expect(() => solveReduction({ vertices: ["A"], edges: [["A"]], k: 1 })).toThrow(ValidationError);
  });

  it("is deterministic (replay produces identical output)", () => {
    const a = solveReduction({ ...path4, k: 2 });
    const b = solveReduction({ ...path4, k: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("vertex cover 2-approximation", () => {
  it("covers all edges on the path and satisfies the guarantee", () => {
    const r = solveVertexCover(path4);
    const cover = r.result.cover as string[];
    for (const [a, b] of path4.edges) {
      expect(cover.includes(a) || cover.includes(b)).toBe(true);
    }
    // Picked edges form a matching → |C| = 2|M| ≤ 2·OPT.
    const coverSize = r.result.coverSize as number;
    const matchingSize = r.result.matchingSize as number;
    const optLower = r.result.optimalLowerBound as number;
    expect(coverSize).toBe(2 * matchingSize);
    expect(coverSize).toBeLessThanOrEqual(2 * optLower);
  });

  it("returns the optimal cover on a star graph (center + 3 leaves)", () => {
    const r = solveVertexCover({
      vertices: ["C", "L1", "L2", "L3"],
      edges: [
        ["C", "L1"],
        ["C", "L2"],
        ["C", "L3"],
      ],
    });
    // Sorted order picks C–L1 first, covering everything; cover = {C, L1}.
    expect(r.result.coverSize).toBe(2);
    expect(r.result.optimalLowerBound).toBe(1);
  });

  it("handles the empty graph (no edges)", () => {
    const r = solveVertexCover({ vertices: ["A", "B"], edges: [] });
    expect(r.result.cover).toEqual([]);
    expect(r.result.coverSize).toBe(0);
  });

  it("handles a single edge", () => {
    const r = solveVertexCover({ vertices: ["A", "B"], edges: [["A", "B"]] });
    expect((r.result.cover as string[]).sort()).toEqual(["A", "B"]);
  });

  it("rejects duplicate edges", () => {
    expect(() =>
      solveVertexCover({
        vertices: ["A", "B"],
        edges: [
          ["A", "B"],
          ["B", "A"],
        ],
      }),
    ).toThrow(ValidationError);
  });

  it("is deterministic", () => {
    const a = solveVertexCover(path4);
    const b = solveVertexCover(path4);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("cook-levin tableau encoding (bounded)", () => {
  const machine = {
    states: ["q0", "q1", "qacc"],
    alphabet: ["0", "1", "_"],
    startState: "q0",
    acceptState: "qacc",
    transitions: [
      { from: "q0", read: "0", to: "q1", write: "1", move: "R" as const },
      { from: "q1", read: "1", to: "qacc", write: "1", move: "R" as const },
      { from: "q0", read: "1", to: "q0", write: "1", move: "L" as const },
    ],
  };

  it("builds variables and clause templates for the fixed machine", () => {
    const r = solveCookLevin({ machine, input: "01", steps: 3 });
    expect(r.result.variables).toBeGreaterThan(0);
    expect(r.result.clauseTemplates).toBeGreaterThan(0);
    expect(r.result.tableauRows).toBe(4);
    expect(r.result.tapeColumns).toBe(6); // n=2 + T=3 + 1
  });

  it("counts valid vs forbidden windows", () => {
    const r = solveCookLevin({ machine, input: "01", steps: 3 });
    expect(r.result.validWindows).toBeGreaterThan(0);
    expect(r.result.forbiddenWindows).toBeGreaterThan(0);
  });

  it("reports the analytic complete-formula clause count", () => {
    const r = solveCookLevin({ machine, input: "01", steps: 3 });
    // H = 6, T = 3, |Σ| = 3, |Q| = 3
    // initialClauseCount = H × (|Σ| + |Q|) = 6 × 6 = 36
    // windowPositions = T × (H − 2) = 3 × 4 = 12
    // completeFormulaClauses = 36 + 1 + 12 × forbiddenWindows
    const forbiddenWindows = r.result.forbiddenWindows as number;
    const windowPositions = r.result.windowPositions as number;
    const completeFormulaClauses = r.result.completeFormulaClauses as number;
    const clauseTemplates = r.result.clauseTemplates as number;
    expect(windowPositions).toBe(12);
    expect(completeFormulaClauses).toBe(36 + 1 + 12 * forbiddenWindows);
    // clauseTemplates = initial + accept + forbiddenWindows = 36 + 1 + forbiddenWindows
    expect(clauseTemplates).toBe(36 + 1 + forbiddenWindows);
  });

  it("rejects machines that are too large for the bounded illustration", () => {
    expect(() =>
      solveCookLevin({
        machine: { ...machine, states: ["a", "b", "c", "d", "e"] },
        input: "01",
        steps: 3,
      }),
    ).toThrow(ValidationError);
  });

  it("rejects unknown input symbols", () => {
    expect(() => solveCookLevin({ machine, input: "0x", steps: 3 })).toThrow(ValidationError);
  });

  it("rejects step bounds outside 1..5", () => {
    expect(() => solveCookLevin({ machine, input: "01", steps: 0 })).toThrow(ValidationError);
    expect(() => solveCookLevin({ machine, input: "01", steps: 6 })).toThrow(ValidationError);
  });

  it("is deterministic", () => {
    const a = solveCookLevin({ machine, input: "01", steps: 3 });
    const b = solveCookLevin({ machine, input: "01", steps: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("randomized max-cut (seeded)", () => {
  const graph = {
    vertices: ["A", "B", "C", "D"],
    edges: [
      ["A", "B"],
      ["A", "C"],
      ["B", "C"],
      ["B", "D"],
      ["C", "D"],
    ] as [string, string][],
  };

  it("reproduces the exact same trials for a fixed seed", () => {
    const a = solveMaxCut({ ...graph, seed: 42, trials: 5 });
    const b = solveMaxCut({ ...graph, seed: 42, trials: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces different trials for different seeds (with high probability)", () => {
    const a = solveMaxCut({ ...graph, seed: 1, trials: 5 });
    const b = solveMaxCut({ ...graph, seed: 2, trials: 5 });
    expect(JSON.stringify(a.result)).not.toBe(JSON.stringify(b.result));
  });

  it("reports the theoretical expectation m/2", () => {
    const r = solveMaxCut({ ...graph, seed: 42, trials: 5 });
    expect(r.result.expectedCut).toBe(2.5);
    expect(r.guarantee).toContain("m/2");
  });

  it("keeps cut values within [0, m]", () => {
    const r = solveMaxCut({ ...graph, seed: 7, trials: 10 });
    expect(r.result.bestCut).toBeLessThanOrEqual(5);
    expect(r.result.worstCut).toBeGreaterThanOrEqual(0);
  });

  it("rejects invalid seeds and trial counts", () => {
    expect(() => solveMaxCut({ ...graph, seed: -1, trials: 5 })).toThrow(ValidationError);
    expect(() => solveMaxCut({ ...graph, seed: 1.5, trials: 5 })).toThrow(ValidationError);
    expect(() => solveMaxCut({ ...graph, seed: 42, trials: 0 })).toThrow(ValidationError);
    expect(() => solveMaxCut({ ...graph, seed: 42, trials: 51 })).toThrow(ValidationError);
  });

  it("handles a single vertex with no edges", () => {
    const r = solveMaxCut({ vertices: ["A"], edges: [], seed: 1, trials: 3 });
    expect(r.result.averageCut).toBe(0);
    expect(r.result.expectedCut).toBe(0);
  });
});
