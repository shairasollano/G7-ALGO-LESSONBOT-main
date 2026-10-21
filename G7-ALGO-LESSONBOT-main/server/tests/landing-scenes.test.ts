/**
 * Landing-scene fixture verification.
 *
 * The landing page animates algorithm scenes from `shared/landing-scenes.ts`.
 * This suite re-runs the REAL deterministic solvers on the REAL curated
 * examples and asserts the fixtures still match them, so a landing animation
 * can never drift from the maths it claims to show, and no invented value can
 * survive in the fixture.
 */
import { describe, expect, it } from "vitest";
import {
  COOK_LEVIN_MACHINE,
  cookLevinTableau,
  landingDemos,
  landingScenes,
  sceneById,
  sceneEdgeKey,
  TOPIC_PROMPTS,
  type Scene,
  type SceneStep,
} from "../../shared/landing-scenes.js";
import { runSolver } from "../src/services/algorithms/registry.js";
import { curatedExamples, getExample, traceFromResult } from "../src/services/algorithms/curated-examples.js";
import { topics } from "../src/data/topics.js";
import type { SolverResult, TraceStep } from "../../shared/contract.js";

/** Flatten a solver step's graph snapshot into the fixture's state-map shape. */
function solverNodeStates(step: TraceStep): Record<string, string> {
  return Object.fromEntries((step.graph?.nodes ?? []).map((n) => [n.id, n.state]));
}

function solverEdgeStates(step: TraceStep): Record<string, string> {
  return Object.fromEntries(
    (step.graph?.edges ?? []).map((e) => [sceneEdgeKey(e.source, e.target), e.state]),
  );
}

function solverTable(step: TraceStep): { columns: string[]; rows: (string | number)[][] } | null {
  const table = step.table;
  if (!table) return null;
  return {
    columns: table.columns.map((c) => c.header),
    rows: table.rows.map((row) => table.columns.map((c) => row[c.key] as string | number)),
  };
}

function runScene(scene: Scene): SolverResult {
  expect(scene.solverId, `scene ${scene.id} must name a solver`).toBeTruthy();
  const example = getExample(scene.exampleId!);
  expect(example, `scene ${scene.id} must reference a real curated example`).toBeTruthy();
  expect(example!.solverId).toBe(scene.solverId);
  return runSolver(scene.solverId!, example!.input);
}

function selectedIds(step: SceneStep, graphKey: string): string[] {
  const states = step.graphs?.[graphKey]?.nodeStates ?? {};
  return Object.entries(states)
    .filter(([, state]) => state === "selected")
    .map(([id]) => id)
    .sort();
}

describe("landing scene fixtures", () => {
  it("covers every supported topic exactly once and names no invented topic", () => {
    const slugs = topics.map((t) => t.slug);
    expect(landingScenes.length).toBe(slugs.length);
    for (const scene of landingScenes) {
      expect(slugs, `scene ${scene.id} references topic "${scene.topicId}"`).toContain(scene.topicId);
    }
    // One scene per topic, no duplicates.
    expect(new Set(landingScenes.map((s) => s.topicId)).size).toBe(landingScenes.length);
    // Every topic has a chat prompt for the landing CTAs.
    for (const slug of slugs) {
      expect(TOPIC_PROMPTS[slug], `TOPIC_PROMPTS["${slug}"]`).toBeTruthy();
    }
  });

  it("every scene example exists in the curated example set", () => {
    const ids = curatedExamples.map((e) => e.id);
    for (const scene of landingScenes) {
      expect(ids, `scene ${scene.id}`).toContain(scene.exampleId);
    }
  });

  it("every scene has at least two steps and the first step has no highlights", () => {
    for (const scene of landingScenes) {
      expect(scene.steps.length, `scene ${scene.id}`).toBeGreaterThanOrEqual(2);
      for (const step of scene.steps) {
        expect(step.title.trim().length, `${scene.id} step ${step.step} title`).toBeGreaterThan(0);
        expect(step.description.trim().length, `${scene.id} step ${step.step} description`).toBeGreaterThan(0);
      }
      // Step numbering is 1..n in order.
      expect(scene.steps.map((s) => s.step)).toEqual(scene.steps.map((_, i) => i + 1));
    }
  });
});

describe("polynomial-reductions scene", () => {
  const scene = sceneById("reductions")!;
  const result = runScene(scene);

  it("uses the solver's own graph as the source and target topology", () => {
    const vertices = result.input.vertices as string[];
    const edges = result.input.edges as [string, string][];
    for (const graph of scene.graphs) {
      expect(graph.nodes.map((n) => n.id)).toEqual(vertices);
      expect(graph.edges.map((e) => sceneEdgeKey(e.source, e.target)).sort()).toEqual(
        edges.map(([a, b]) => sceneEdgeKey(a, b)).sort(),
      );
    }
  });

  it("highlights the solver's witness independent set and its complement cover", () => {
    const witness = result.result.witness as { independentSet: string[]; complementCover: string[] };
    const dualityStep = scene.steps.find((s) => s.step === 3)!;
    expect(selectedIds(dualityStep, "source")).toEqual([...witness.independentSet].sort());
    expect(selectedIds(dualityStep, "target")).toEqual([...witness.complementCover].sort());
  });

  it("labels the direction and the parameter mapping with the solver's values", () => {
    expect(scene.mappingLabel).toContain("n − k");
    expect(scene.graphs[0].label).toContain(`k = ${result.input.k}`);
    expect(scene.graphs[1].label).toContain(`n − k = ${result.result.targetParameter}`);
    expect(result.result.targetParameter).toBe((result.input.vertices as string[]).length - (result.input.k as number));
  });

  it("carries the solver's step text and the transformation table", () => {
    expect(scene.steps.map((s) => s.title)).toEqual(result.steps.map((s) => s.title));
    expect(scene.steps.map((s) => s.description)).toEqual(result.steps.map((s) => s.description));
    const transformTable = scene.steps.find((s) => s.step === 2)!.table;
    expect({ columns: transformTable!.columns, rows: transformTable!.rows }).toEqual(solverTable(result.steps[1]));
    const dualityTable = scene.steps.find((s) => s.step === 3)!.table;
    expect({ columns: dualityTable!.columns, rows: dualityTable!.rows }).toEqual(solverTable(result.steps[2]));
  });
});

describe("independent-set ↔ vertex-cover scene", () => {
  const scene = sceneById("independent-set")!;
  const result = runScene(scene);

  it("highlights the same graph's independent set, then its complement as the cover", () => {
    const witness = result.result.witness as { independentSet: string[]; complementCover: string[] };
    const setStep = scene.steps.find((s) => s.step === 2)!;
    const coverStep = scene.steps.find((s) => s.step === 3)!;

    expect(selectedIds(setStep, "g")).toEqual([...witness.independentSet].sort());
    expect(selectedIds(coverStep, "g")).toEqual([...witness.complementCover].sort());

    // The two highlighted selections partition the same vertex set.
    const union = [...selectedIds(setStep, "g"), ...selectedIds(coverStep, "g")].sort();
    expect(union).toEqual((result.input.vertices as string[]).slice().sort());
  });

  it("shows no edge inside the independent set and every edge covered by the complement", () => {
    const setStep = scene.steps.find((s) => s.step === 2)!;
    const coverStep = scene.steps.find((s) => s.step === 3)!;
    const inside = selectedIds(setStep, "g");
    for (const edge of scene.graphs[0].edges) {
      // No edge may have both endpoints inside the highlighted independent set.
      expect(inside.includes(edge.source) && inside.includes(edge.target)).toBe(false);
    }
    // Every edge is covered at the cover step.
    for (const edge of scene.graphs[0].edges) {
      expect(coverStep.graphs!.g.edgeStates[sceneEdgeKey(edge.source, edge.target)]).toBe("covered");
    }
  });

  it("reuses the solver's duality step text", () => {
    const coverStep = scene.steps.find((s) => s.step === 3)!;
    expect(coverStep.title).toBe(result.steps[2].title);
    expect(coverStep.description).toBe(result.steps[2].description);
  });
});

describe("vertex-cover 2-approximation scene", () => {
  const scene = sceneById("vertex-cover")!;
  const result = runScene(scene);

  it("reproduces the solver's per-step node and edge states exactly", () => {
    expect(scene.steps.length).toBe(result.steps.length);
    scene.steps.forEach((step, i) => {
      const solverStep = result.steps[i];
      expect(step.title, `step ${step.step} title`).toBe(solverStep.title);
      expect(step.description, `step ${step.step} description`).toBe(solverStep.description);
      expect(step.graphs!.g.nodeStates, `step ${step.step} nodes`).toEqual(solverNodeStates(solverStep));
      expect(step.graphs!.g.edgeStates, `step ${step.step} edges`).toEqual(solverEdgeStates(solverStep));
    });
  });

  it("reproduces the solver's tables and signals the picked edge", () => {
    scene.steps.forEach((step, i) => {
      const expected = solverTable(result.steps[i]);
      if (expected) {
        expect({ columns: step.table!.columns, rows: step.table!.rows }, `step ${step.step} table`).toEqual(expected);
      }
      const picked = result.steps[i].highlightEdges ?? [];
      expect(step.signals ?? [], `step ${step.step} signals`).toEqual(picked);
    });
  });

  it("terminates with a genuine cover and the matching guarantee", () => {
    const last = scene.steps[scene.steps.length - 1];
    const cover = Object.entries(last.graphs!.g.nodeStates)
      .filter(([, s]) => s === "selected")
      .map(([id]) => id)
      .sort();
    expect(cover).toEqual([...(result.result.cover as string[])].sort());
    expect(result.result.coverSize).toBe(cover.length);
    // The displayed guarantee is the solver's own, and it is the 2·OPT bound.
    expect(result.guarantee).toContain("2·OPT");
    expect(result.result.matchingSize).toBe(result.result.optimalLowerBound);
  });
});

describe("randomized max-cut scene", () => {
  const scene = sceneById("max-cut")!;
  const result = runScene(scene);

  it("reproduces every seeded trial's assignment, cut edges and running average", () => {
    expect(scene.steps.length).toBe(result.steps.length);
    scene.steps.forEach((step, i) => {
      const solverStep = result.steps[i];
      expect(step.title).toBe(solverStep.title);
      expect(step.description).toBe(solverStep.description);
      expect(step.graphs!.g.nodeStates, `trial step ${step.step} nodes`).toEqual(solverNodeStates(solverStep));
      expect(step.graphs!.g.edgeStates, `trial step ${step.step} edges`).toEqual(solverEdgeStates(solverStep));
      const expected = solverTable(solverStep);
      if (expected) {
        expect({ columns: step.table!.columns, rows: step.table!.rows }, `step ${step.step} table`).toEqual(expected);
      }
    });
  });

  it("signals exactly the cut edges of each trial", () => {
    scene.steps.forEach((step, i) => {
      const cut = (result.steps[i].graph?.edges ?? [])
        .filter((e) => e.state === "cut")
        .map((e) => sceneEdgeKey(e.source, e.target))
        .sort();
      expect([...(step.signals ?? [])].sort(), `step ${step.step} signals`).toEqual(cut);
    });
  });

  it("only assigns the two declared sides and reports the real statistics", () => {
    const sides = new Set(["side_a", "side_b"]);
    for (const step of scene.steps) {
      for (const state of Object.values(step.graphs!.g.nodeStates)) {
        expect(["default", ...sides]).toContain(state);
      }
    }
    expect(result.result.trials).toBe(5);
    expect(result.result.seed).toBe(42);
    expect(result.result.expectedCut).toBe(2.5); // m/2 for m = 5
    expect(result.result.averageCut).toBe(3.4);
    expect(result.result.bestCut).toBe(4);
    expect(result.result.worstCut).toBe(3);
    // The theoretical expectation is m/2, not the seeded sample average.
    expect(result.result.expectedCut).not.toBe(result.result.averageCut);
    // Every trial's cut value must be reachable: 0..m.
    for (const step of scene.steps.filter((s) => s.table && s.table.columns[0] === "Trial")) {
      const cut = step.table!.rows[0][1] as number;
      expect(cut).toBeGreaterThanOrEqual(0);
      expect(cut).toBeLessThanOrEqual(5);
    }
  });

  it("keeps the honest warning about a single seeded run", () => {
    expect(result.warnings?.[0]).toContain("not all possible runs");
    expect(scene.caption).toContain("not a promise");
  });
});

describe("cook-levin tableau scene", () => {
  const scene = sceneById("cook-levin")!;
  const result = runScene(scene);

  it("uses the machine and step bound from the curated example", () => {
    expect(scene.tableau!.machine).toEqual(result.input.machine);
    expect(scene.tableau!.input).toBe(result.input.input);
    expect(scene.tableau!.stepBound).toBe(result.input.steps);
    expect(COOK_LEVIN_MACHINE).toEqual(result.input.machine);
  });

  it("simulates a real accepting run inside the step bound", () => {
    const { machine, input, stepBound } = scene.tableau!;
    const rows = cookLevinTableau(machine, input, stepBound);

    // Dimensions are exactly what the solver reports for this bounded instance.
    expect(rows.length).toBe(result.result.tableauRows);
    expect(rows[0].cells.length).toBe(result.result.tapeColumns);

    // Row 0 spells the input with blanks and starts the head at cell 0 in q0.
    expect(rows[0].cells.map((c) => c.symbol).slice(0, input.length).join("")).toBe(input);
    expect(rows[0].cells.slice(input.length).every((c) => c.symbol === "_")).toBe(true);
    expect(rows[0].cells[0].head).toBe(machine.startState);
    expect(rows[0].cells.slice(1).every((c) => c.head === null)).toBe(true);

    // The run reaches the accepting state within T steps.
    const acceptRow = rows.find((r) => r.cells.some((c) => c.head === machine.acceptState));
    expect(acceptRow, "the run must reach the accepting state").toBeTruthy();
    expect(acceptRow!.time).toBeLessThanOrEqual(stepBound);

    // Every step before acceptance is a legal transition of the machine.
    for (let t = 0; t < acceptRow!.time; t++) {
      const headCell = rows[t].cells.findIndex((c) => c.head !== null);
      expect(headCell).toBeGreaterThanOrEqual(0);
      const state = rows[t].cells[headCell].head!;
      const read = rows[t].cells[headCell].symbol;
      const transition = machine.transitions.find((tr) => tr.from === state && tr.read === read);
      expect(transition, `t=${t} (${state}, ${read}) must have a transition`).toBeTruthy();
      expect(rows[t + 1].cells[headCell].symbol).toBe(transition!.write);
      const movedHead = transition!.move === "R" ? headCell + 1 : headCell - 1;
      expect(rows[t + 1].cells[movedHead].head).toBe(transition!.to);
    }
  });

  it("annotates the initial configuration, a transition window and the accepting cell", () => {
    const steps = scene.steps;
    // Initial configuration is highlighted from step 2 on.
    expect(steps[0].tableau?.initialConfig).toBeFalsy();
    expect(steps[1].tableau?.initialConfig).toBe(true);
    expect(steps[1].tableau?.filled).toBe(true);
    // Accepting condition appears at step 3, the transition window at step 4.
    expect(steps[2].tableau?.accept).toBe(true);
    expect(steps[3].tableau?.window).toEqual({ row: 0, col: 1 });
    expect(steps[4].tableau?.window).toEqual({ row: 0, col: 1 });
    // Every declared window must sit inside the tableau.
    const columns = result.result.tapeColumns as number;
    const rowsCount = result.result.tableauRows as number;
    for (const step of steps) {
      const w = step.tableau?.window;
      if (!w) continue;
      expect(w.row).toBeGreaterThanOrEqual(0);
      expect(w.row + 1).toBeLessThan(rowsCount);
      expect(w.col).toBeGreaterThanOrEqual(1);
      expect(w.col + 1).toBeLessThan(columns);
    }
  });

  it("carries the solver's own counts and the bounded-illustration warning", () => {
    expect(scene.steps.map((s) => s.title)).toEqual(result.steps.map((s) => s.title));
    expect(scene.steps.map((s) => s.description)).toEqual(result.steps.map((s) => s.description));
    for (const step of scene.steps) {
      const expected = solverTable(result.steps[step.step - 1]);
      if (expected) {
        expect({ columns: step.table!.columns, rows: step.table!.rows }, `step ${step.step} table`).toEqual(expected);
      }
    }
    // No graph drawing for this scene: the tableau is the visual.
    expect(scene.graphs).toHaveLength(0);
    expect(scene.tableau!.caption).toContain(`T = ${result.input.steps}`);
    expect(result.warnings?.[0]).toContain("not a general-purpose translator");
  });
});

describe("interactive demo traces", () => {
  it("are the app's own traceFromResult output for a live solver run", () => {
    expect(landingDemos.length).toBeGreaterThan(0);
    for (const demo of landingDemos) {
      const example = getExample(demo.id);
      expect(example, `demo ${demo.id} must reference a curated example`).toBeTruthy();
      expect(example!.solverId).toBe(demo.solverId);
      expect(demo.trace).toEqual(traceFromResult(runSolver(demo.solverId, example!.input)));
    }
  });

  it("carry a computed result, a guarantee and step-by-step text the demo can show", () => {
    for (const demo of landingDemos) {
      expect(demo.label.trim().length).toBeGreaterThan(0);
      expect(demo.caption.trim().length).toBeGreaterThan(0);
      expect(demo.trace.steps.length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(demo.trace.result).length).toBeGreaterThan(0);
      expect(demo.trace.complexity.time.length).toBeGreaterThan(0);
      for (const step of demo.trace.steps) {
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(step.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("shows a graph at every step of the vertex-cover demo", () => {
    const demo = landingDemos.find((d) => d.id === "ex-vertex-cover")!;
    for (const step of demo.trace.steps) {
      expect(step.graph, `step ${step.step} must carry a graph snapshot`).toBeTruthy();
      expect(step.graph!.nodes.length).toBeGreaterThan(0);
      // Every edge must reference nodes that exist in the same snapshot.
      const ids = new Set(step.graph!.nodes.map((n) => n.id));
      for (const edge of step.graph!.edges) {
        expect(ids.has(edge.source)).toBe(true);
        expect(ids.has(edge.target)).toBe(true);
      }
    }
    expect(demo.trace.guarantee).toContain("2·OPT");
  });
});

describe("cookLevinTableau simulator", () => {
  const machine = COOK_LEVIN_MACHINE;

  it("repeats the final configuration once the machine has halted", () => {
    const rows = cookLevinTableau(machine, "01", 3);
    const last = rows[rows.length - 1];
    expect(last.cells.some((c) => c.head === machine.acceptState)).toBe(true);
  });

  it("drops the head marker when no transition applies", () => {
    const stuck = cookLevinTableau(machine, "1", 3);
    // '1' in q0 moves left off the tape, so the run stalls with no head.
    expect(stuck[stuck.length - 1].cells.every((c) => c.head === null)).toBe(true);
  });

  it("is deterministic", () => {
    expect(cookLevinTableau(machine, "01", 3)).toEqual(cookLevinTableau(machine, "01", 3));
  });
});
