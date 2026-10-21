/**
 * Solver: 2-approximation algorithm for Vertex Cover (Topic 4).
 *
 * Repeatedly choose an uncovered edge and add both endpoints to the cover
 * until no uncovered edges remain. The picked edges form a matching, so
 * |C| = 2·|M| ≤ 2·OPT. Deterministic: edges are chosen in sorted order.
 */
import type { SolverResult, TraceStep } from "../../../../shared/contract.js";
import { LIMITS, RawGraph, suggestLayout, toGraphData, validateGraph, edgeId, ValidationError } from "./graph-utils.js";

export interface VertexCoverInput {
  vertices: string[];
  edges: [string, string][];
}

export function solveVertexCover(input: unknown): SolverResult {
  const parsed = input as VertexCoverInput;
  const raw: RawGraph = validateGraph(parsed?.vertices, parsed?.edges);
  const layout = suggestLayout(raw);

  // Deterministic edge order: sorted by (source, target).
  const sortedEdges = [...raw.edges].sort(([a1, b1], [a2, b2]) =>
    a1 === a2 ? (b1 < b2 ? -1 : 1) : a1 < a2 ? -1 : 1,
  );

  const inCover = new Set<string>();
  const coveredEdges = new Set<string>();
  const pickedEdges: [string, string][] = [];
  const steps: TraceStep[] = [];

  const graphAt = (activeEdge?: [string, string]) =>
    toGraphData(
      raw,
      (v) => (inCover.has(v) ? "selected" : "default"),
      (a, b) => {
        const id = edgeId(a, b);
        if (activeEdge && ((activeEdge[0] === a && activeEdge[1] === b) || (activeEdge[0] === b && activeEdge[1] === a))) {
          return "active";
        }
        return coveredEdges.has(id) ? "covered" : "uncovered";
      },
      layout,
      "straight",
    );

  steps.push({
    step: 1,
    title: "Initialize",
    description: `Start with an empty cover and all ${raw.edges.length} edges uncovered. While any edge remains uncovered, pick the first uncovered edge (in sorted order) and add both endpoints to the cover.`,
    graph: graphAt(),
    table: {
      columns: [
        { key: "cover", header: "Current cover" },
        { key: "uncovered", header: "Uncovered edges" },
      ],
      rows: [{ cover: "∅", uncovered: raw.edges.length }],
    },
  });

  let stepNo = 1;
  for (const [a, b] of sortedEdges) {
    const id = edgeId(a, b);
    if (coveredEdges.has(id)) continue;
    stepNo += 1;
    const added: string[] = [];
    if (!inCover.has(a)) {
      inCover.add(a);
      added.push(a);
    }
    if (!inCover.has(b)) {
      inCover.add(b);
      added.push(b);
    }
    pickedEdges.push([a, b]);
    // Cover every edge incident to a or b.
    const newlyCovered: string[] = [];
    for (const [x, y] of raw.edges) {
      const eid = edgeId(x, y);
      if (!coveredEdges.has(eid) && (x === a || x === b || y === a || y === b)) {
        coveredEdges.add(eid);
        newlyCovered.push(`${x}${y === x ? "" : "–"}${y}`);
      }
    }
    const uncoveredCount = raw.edges.length - coveredEdges.size;
    steps.push({
      step: stepNo,
      title: `Pick uncovered edge ${a}–${b}`,
      description: `Add ${added.join(" and ")} to the cover${
        newlyCovered.length > 0
          ? `, which newly covers ${newlyCovered.join(", ")}`
          : " (its incident edges were already covered)"
      }. ${uncoveredCount} edge${uncoveredCount === 1 ? "" : "s"} still uncovered.`,
      highlightNodes: [a, b],
      highlightEdges: [id],
      graph: graphAt([a, b]),
      table: {
        columns: [
          { key: "cover", header: "Current cover" },
          { key: "uncovered", header: "Uncovered edges" },
        ],
        rows: [{ cover: `{${[...inCover].sort().join(", ")}}`, uncovered: uncoveredCount }],
      },
    });
    if (uncoveredCount === 0) break;
  }

  const cover = [...inCover].sort();
  const matchingSize = pickedEdges.length;
  const guaranteedOptLowerBound = matchingSize;

  steps.push({
    step: stepNo + 1,
    title: "Terminate with the guarantee",
    description: `No uncovered edges remain, so {${cover.join(", ")}} is a vertex cover of size ${cover.length}. The picked edges {${pickedEdges
      .map(([a, b]) => `${a}–${b}`)
      .join(", ")}} share no vertices — they form a matching of size ${matchingSize}. Any vertex cover needs at least one endpoint per picked edge, so OPT ≥ ${guaranteedOptLowerBound}, and |C| = ${cover.length} ≤ 2·${guaranteedOptLowerBound} ≤ 2·OPT.`,
    graph: toGraphData(
      raw,
      (v) => (inCover.has(v) ? "selected" : "default"),
      (a, b) => "covered",
      layout,
    ),
    table: {
      columns: [
        { key: "quantity", header: "Quantity" },
        { key: "value", header: "Value" },
      ],
      rows: [
        { quantity: "|C| (algorithm's cover)", value: cover.length },
        { quantity: "|M| (picked matching)", value: matchingSize },
        { quantity: "OPT (unknown optimum)", value: `≥ ${guaranteedOptLowerBound}` },
        { quantity: "Guarantee", value: `|C| ≤ 2·OPT (ρ = 2)` },
      ],
    },
  });

  return {
    algorithmId: "vertex-cover-2approx",
    algorithmName: "2-Approximation Vertex Cover",
    topicId: "approximation-algorithms",
    input: { vertices: raw.vertices, edges: raw.edges },
    steps,
    result: {
      cover,
      coverSize: cover.length,
      pickedEdges: pickedEdges.map(([a, b]) => `${a}–${b}`),
      matchingSize,
      optimalLowerBound: guaranteedOptLowerBound,
    },
    complexity: { time: "O(n + m)", space: "O(n + m)" },
    guarantee: `The picked edges form a matching of size ${matchingSize}, so |C| = 2|M| ≤ 2·OPT (2-approximation, worst case).`,
  };
}
