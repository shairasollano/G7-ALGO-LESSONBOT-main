/**
 * Solver: Independent Set ≤p Vertex Cover (Topics 1 & 2).
 *
 * The reduction keeps the same graph and maps the parameter k ↦ n − k.
 * Correctness rests on the exact complement duality:
 *   S is an independent set  ⟺  V ∖ S is a vertex cover.
 * This solver computes the transformed instance, the parameter mapping,
 * and verifies the duality on the given graph (including an explicit
 * witness check when a YES/NO answer can be determined for small graphs).
 */
import type { SolverResult, TraceStep } from "../../../../shared/contract.js";
import { LIMITS, RawGraph, suggestLayout, toGraphData, validateGraph, ValidationError } from "./graph-utils.js";

export interface ReductionInput {
  vertices: string[];
  edges: [string, string][];
  k: number;
}

function bruteForceIndependentSet(raw: RawGraph, k: number): string[] | null {
  const n = raw.vertices.length;
  if (n > 16) return null; // brute force only for tiny instances
  const adjacency = new Map<string, Set<string>>(raw.vertices.map((v) => [v, new Set()]));
  for (const [a, b] of raw.edges) {
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }
  for (let mask = 0; mask < 1 << n; mask++) {
    const subset = raw.vertices.filter((_, i) => mask & (1 << i));
    if (subset.length < k) continue;
    const independent = subset.every((v) => subset.every((w) => w === v || !adjacency.get(v)!.has(w)));
    if (independent) return subset;
  }
  return null;
}

export function solveReduction(input: unknown): SolverResult {
  const parsed = input as ReductionInput;
  const raw: RawGraph = validateGraph(parsed?.vertices, parsed?.edges);
  const k = parsed?.k;
  if (typeof k !== "number" || !Number.isInteger(k) || k < 0 || k > raw.vertices.length) {
    throw new ValidationError("invalid_parameter", `k must be an integer between 0 and ${raw.vertices.length} (got ${String(k)}).`);
  }

  const n = raw.vertices.length;
  const kPrime = n - k;

  // Verify the complement duality concretely on this graph:
  // find an independent set S (brute force, tiny graphs) and check V∖S is a vertex cover.
  const witness = bruteForceIndependentSet(raw, k);
  const witnessInfo = witness
    ? {
        independentSet: witness,
        complementCover: raw.vertices.filter((v) => !witness.includes(v)),
      }
    : null;

  const steps: TraceStep[] = [];
  const baseGraph = toGraphData(raw, undefined, undefined, suggestLayout(raw), "straight");

  steps.push({
    step: 1,
    title: "Validate the source instance",
    description: `The instance is a graph with ${n} vertices and ${raw.edges.length} edges, and parameter k = ${k} for Independent Set. The graph is well formed: unique vertex ids, valid edge endpoints, no duplicate edges.`,
    graph: baseGraph,
  });

  steps.push({
    step: 2,
    title: "Apply the transformation f(G, k) = (G, n − k)",
    description: `Keep the same graph and map the parameter: k = ${k} ↦ n − k = ${n} − ${k} = ${kPrime}. The transformed instance asks whether the graph has a vertex cover of size ≤ ${kPrime}. The transformation runs in O(n + m) time.`,
    graph: baseGraph,
    table: {
      columns: [
        { key: "quantity", header: "Quantity" },
        { key: "value", header: "Value" },
      ],
      rows: [
        { quantity: "n (vertices)", value: n },
        { quantity: "m (edges)", value: raw.edges.length },
        { quantity: "k (Independent Set parameter)", value: k },
        { quantity: "n − k (Vertex Cover parameter)", value: kPrime },
      ],
    },
  });

  if (witnessInfo) {
    const cover = witnessInfo.complementCover;
    const coversAll = raw.edges.every(([a, b]) => cover.includes(a) || cover.includes(b));
    steps.push({
      step: 3,
      title: "Verify the complement duality on this instance",
      description: `The graph has an independent set S = {${witnessInfo.independentSet.join(", ")}} of size ${witnessInfo.independentSet.length}. Its complement V ∖ S = {${cover.join(", ")}} touches every edge: ${coversAll ? "verified — it is a vertex cover" : "check failed"}. This witnesses the (⇒) direction: a YES instance of Independent Set maps to a YES instance of Vertex Cover.`,
      graph: toGraphData(
        raw,
        (v) => (witnessInfo.independentSet.includes(v) ? "selected" : "covered"),
        (a, b) => (cover.includes(a) || cover.includes(b) ? "covered" : "uncovered"),
        suggestLayout(raw),
      ),
      table: {
        columns: [
          { key: "set", header: "Set" },
          { key: "members", header: "Members" },
          { key: "property", header: "Verified property" },
        ],
        rows: [
          { set: "S", members: `{${witnessInfo.independentSet.join(", ")}}`, property: "no edge inside (independent set)" },
          { set: "V ∖ S", members: `{${cover.join(", ")}}`, property: "touches every edge (vertex cover)" },
        ],
      },
    });
  } else {
    steps.push({
      step: 3,
      title: "State the correctness argument",
      description:
        "For any subset S ⊆ V: S is an independent set (no edge has both endpoints in S) if and only if every edge has at least one endpoint in V ∖ S, i.e. V ∖ S is a vertex cover. Hence G has an independent set of size ≥ k iff G has a vertex cover of size ≤ n − k. Both directions of the iff hold for every instance, not just this one.",
      graph: baseGraph,
    });
  }

  steps.push({
    step: 4,
    title: "Complexity of the transformation",
    description:
      "Copying the graph takes O(n + m) time and O(n + m) space; computing n − k is O(1). The transformation is polynomial-time, as required for a polynomial-time reduction.",
    graph: baseGraph,
  });

  return {
    algorithmId: "reduction-is-to-vc",
    algorithmName: "Independent Set ≤p Vertex Cover",
    topicId: "formal-reductions",
    input: { vertices: raw.vertices, edges: raw.edges, k },
    steps,
    result: {
      transformation: "f(G, k) = (G, n − k)",
      sourceParameter: k,
      targetParameter: kPrime,
      duality: "S independent ⟺ V ∖ S vertex cover",
      witness: witnessInfo,
    },
    complexity: { time: "O(n + m)", space: "O(n + m)" },
    guarantee: "Answer-preserving in both directions: x ∈ Independent Set ⟺ f(x) ∈ Vertex Cover.",
    warnings:
      n > LIMITS.maxVertices
        ? [`Brute-force witness check skipped for n > ${LIMITS.maxVertices}; correctness argument is stated generally.`]
        : [],
  };
}
