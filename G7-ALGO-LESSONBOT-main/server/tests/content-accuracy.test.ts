/**
 * Educational content accuracy: every asserted number, table value, graph
 * layout, and trace claim must agree with the deterministic computation.
 * These tests fail if a hardcoded explanation contradicts the solver.
 */
import { describe, expect, it } from "vitest";
import { solveCookLevin, type CookLevinMachine } from "../src/services/algorithms/cook-levin-solver.js";
import { solveMaxCut } from "../src/services/algorithms/max-cut-solver.js";
import { solveReduction } from "../src/services/algorithms/reduction-solver.js";
import { solveVertexCover } from "../src/services/algorithms/vertex-cover-solver.js";
import { suggestLayout, type RawGraph } from "../src/services/algorithms/graph-utils.js";

const canonicalMachine: CookLevinMachine = {
  states: ["q0", "q1", "qacc"],
  alphabet: ["0", "1", "_"],
  startState: "q0",
  acceptState: "qacc",
  transitions: [
    { from: "q0", read: "0", to: "q1", write: "1", move: "R" },
    { from: "q1", read: "1", to: "qacc", write: "1", move: "R" },
    { from: "q0", read: "1", to: "q0", write: "1", move: "L" },
  ],
};

const path4: RawGraph = {
  vertices: ["A", "B", "C", "D"],
  edges: [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
  ],
};

const triangle: RawGraph = {
  vertices: ["A", "B", "C"],
  edges: [
    ["A", "B"],
    ["B", "C"],
    ["A", "C"],
  ],
};

describe("Cook–Levin initial-configuration clause count", () => {
  it("states H·(|Σ|+|Q|) unit clauses, matching the analytic count", () => {
    const r = solveCookLevin({ machine: canonicalMachine, input: "01", steps: 3 });
    const H = 2 + 3 + 1; // input length + steps + 1
    const expected = H * (3 + 3); // H·(|Σ|+|Q|) = 36
    const text = r.steps[1]?.description ?? "";
    expect(text).toContain(`${expected} unit clauses in total`);
    expect(text).not.toContain("22 unit clauses");
    // The analytic complete-formula count must start from the same base.
    expect(r.result.completeFormulaClauses).toBeGreaterThan(expected);
  });
});

describe("suggestLayout matches graph shape", () => {
  it("uses a linear layout for a simple path", () => {
    expect(suggestLayout(path4)).toBe("linear");
  });

  it("uses a grid layout for a triangle and other non-path graphs", () => {
    expect(suggestLayout(triangle)).toBe("grid");
  });
});

describe("Vertex Cover trace layouts follow graph shape", () => {
  it("keeps the path example linear so the chain reads left-to-right", () => {
    const r = solveVertexCover({ vertices: path4.vertices, edges: path4.edges });
    for (const step of r.steps) expect(step.graph?.layout).toBe("linear");
  });

  it("uses a grid layout for a triangle instead of a misleading line", () => {
    const r = solveVertexCover({ vertices: triangle.vertices, edges: triangle.edges });
    for (const step of r.steps) expect(step.graph?.layout).toBe("grid");
  });
});

describe("Reduction trace layouts follow graph shape", () => {
  it("keeps the path example linear and uses a grid for the triangle", () => {
    const rPath = solveReduction({ vertices: path4.vertices, edges: path4.edges, k: 2 });
    for (const step of rPath.steps) expect(step.graph?.layout).toBe("linear");
    const rTri = solveReduction({ vertices: triangle.vertices, edges: triangle.edges, k: 1 });
    for (const step of rTri.steps) expect(step.graph?.layout).toBe("grid");
  });
});

describe("Vertex Cover trace agrees with its computed result", () => {
  it("reports a valid cover with the matching guarantee on the path example", () => {
    const r = solveVertexCover({ vertices: path4.vertices, edges: path4.edges });
    const cover = new Set<string>(r.result.cover as string[]);
    // Every edge is touched by the cover.
    for (const [a, b] of path4.edges) {
      expect(cover.has(a) || cover.has(b)).toBe(true);
    }
    // Picked edges form a matching: no shared vertices.
    const picked = (r.result.pickedEdges as string[]).map((s) => s.split("–"));
    const seen = new Set<string>();
    for (const [a, b] of picked) {
      expect(seen.has(a) || seen.has(b)).toBe(false);
      seen.add(a);
      seen.add(b);
    }
    // Guarantee arithmetic: |C| = 2|M| and |C| ≤ 2·OPT with OPT ≥ |M|.
    expect(r.result.coverSize).toBe(2 * (r.result.matchingSize as number));
    expect(r.result.optimalLowerBound).toBe(r.result.matchingSize);
  });
});

describe("Randomized Max-Cut reproducibility", () => {
  it("reproduces the identical trial sequence for a fixed seed", () => {
    const input = { vertices: ["A", "B", "C", "D"], edges: [["A", "B"], ["A", "C"], ["B", "C"], ["B", "D"], ["C", "D"]], seed: 42, trials: 5 };
    const a = solveMaxCut(input);
    const b = solveMaxCut(input);
    expect(a.result).toEqual(b.result);
    const trialTitles = a.steps.slice(1, -1).map((s) => s.title);
    expect(trialTitles[0]).toContain("Trial 1");
    expect(trialTitles[4]).toContain("Trial 5");
    // Expectation is stated as m/2 and kept distinct from the observed average.
    expect(a.result.expectedCut).toBe(2.5);
    expect(a.result.averageCut).not.toBeNaN();
  });
});

describe("Cook–Levin canonical prompt reaches the computed example", () => {
  it("triggers the tableau example on 'Explain Cook–Levin simply'", async () => {
    const { resolveComputation } = await import("../src/services/algorithms/curated-examples.js");
    const intent = resolveComputation("Explain Cook–Levin simply", "cook-levin");
    expect(intent?.explicit).toBe(true);
    expect(intent?.example.solverId).toBe("cook-levin-tableau");
  });

  it("still does not trigger on vague messages without algorithm wording", async () => {
    const { resolveComputation } = await import("../src/services/algorithms/curated-examples.js");
    expect(resolveComputation("Tell me about algorithms", null)).toBeUndefined();
  });

  // Regression: the product's copy writes "Cook–Levin" and "Max–Cut" with an
  // en dash, but the keyword patterns accept a plain hyphen. Folding
  // typographic dashes to "-" before matching keeps both spellings routing to
  // the same solver, whichever character the student (or our own prompt)
  // actually types.
  it("matches algorithm names written with an en dash exactly like the hyphenated spelling", async () => {
    const { resolveComputation } = await import("../src/services/algorithms/curated-examples.js");
    const pairs: [string, string, string][] = [
      ["Explain Cook–Levin simply", "Explain Cook-Levin simply", "cook-levin-tableau"],
      ["run a Max–Cut demo", "run a Max-Cut demo", "randomized-max-cut"],
    ];
    for (const [enDash, hyphen, solverId] of pairs) {
      const dash = resolveComputation(enDash, null);
      const ascii = resolveComputation(hyphen, null);
      expect(dash?.explicit, enDash).toBe(true);
      expect(dash?.example.solverId, enDash).toBe(solverId);
      expect(ascii, hyphen).toEqual(dash);
    }
  });
});

describe("Reduction duality is witnessed correctly", () => {
  it("maps k to n − k and verifies the complement cover on the path example", () => {
    const r = solveReduction({ vertices: path4.vertices, edges: path4.edges, k: 2 });
    expect(r.result.sourceParameter).toBe(2);
    expect(r.result.targetParameter).toBe(2); // n − k = 4 − 2
    const witness = r.result.witness as { independentSet: string[]; complementCover: string[] } | null;
    expect(witness).not.toBeNull();
    if (!witness) return;
    const cover = new Set<string>(witness.complementCover);
    const independent = new Set<string>(witness.independentSet);
    // S is independent: no edge inside S.
    for (const [a, b] of path4.edges) {
      expect(!(independent.has(a) && independent.has(b))).toBe(true);
    }
    // V ∖ S is a cover: every edge touched.
    for (const [a, b] of path4.edges) {
      expect(cover.has(a) || cover.has(b)).toBe(true);
    }
    expect(cover.size).toBe(4 - independent.size);
  });
});
