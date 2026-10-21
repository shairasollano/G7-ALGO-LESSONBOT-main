/**
 * Shared graph utilities for the deterministic solvers.
 * Pure functions, fully typed, no I/O.
 */
import type { GraphData, GraphEdge, GraphNode } from "../../../../shared/contract.js";

export interface RawGraph {
  vertices: string[];
  edges: [string, string][];
}

export class ValidationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export const LIMITS = {
  maxVertices: 24,
  maxEdges: 120,
  maxTrials: 50,
  maxSteps: 40,
  maxTapeCells: 40,
  maxCookLevinSteps: 5,
} as const;

/** Validate a raw graph: unique vertex ids, valid edge endpoints, no malformed pairs, no duplicate edges. */
export function validateGraph(vertices: unknown, edges: unknown): RawGraph {
  if (!Array.isArray(vertices)) {
    throw new ValidationError("invalid_vertices", "vertices must be an array of unique string ids.");
  }
  if (!Array.isArray(edges)) {
    throw new ValidationError("invalid_edges", "edges must be an array of [source, target] pairs.");
  }
  const seen = new Set<string>();
  for (const v of vertices) {
    if (typeof v !== "string" || v.length === 0 || v.length > 16) {
      throw new ValidationError("invalid_vertices", "Each vertex id must be a non-empty string of at most 16 characters.");
    }
    if (seen.has(v)) {
      throw new ValidationError("invalid_vertices", `Duplicate vertex id "${v}".`);
    }
    seen.add(v);
  }
  if (vertices.length > LIMITS.maxVertices) {
    throw new ValidationError("too_large", `At most ${LIMITS.maxVertices} vertices are supported (got ${vertices.length}).`);
  }
  const edgeSet = new Set<string>();
  for (const e of edges) {
    if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== "string" || typeof e[1] !== "string") {
      throw new ValidationError("invalid_edges", "Each edge must be a [source, target] pair of vertex id strings.");
    }
    const [a, b] = e;
    if (!seen.has(a) || !seen.has(b)) {
      throw new ValidationError("invalid_edges", `Edge [${a}, ${b}] references a vertex not in the vertex list.`);
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeSet.has(key)) {
      throw new ValidationError("invalid_edges", `Duplicate edge [${a}, ${b}].`);
    }
    edgeSet.add(key);
  }
  if (edges.length > LIMITS.maxEdges) {
    throw new ValidationError("too_large", `At most ${LIMITS.maxEdges} edges are supported (got ${edges.length}).`);
  }
  return { vertices: [...vertices], edges: edges.map(([a, b]) => [a, b] as [string, string]) };
}

/**
 * Deterministic circular layout for teaching graphs.
 * Nodes are placed on a circle so layouts are stable across replays.
 */
export function circularLayout(vertices: string[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const n = vertices.length;
  const radius = Math.max(90, n * 34);
  vertices.forEach((v, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions.set(v, {
      x: Math.round(radius * Math.cos(angle) * 100) / 100 + radius + 40,
      y: Math.round(radius * Math.sin(angle) * 100) / 100 + radius + 40,
    });
  });
  return positions;
}

/**
 * Linear layout: nodes placed left-to-right in a single row.
 * Ideal for paths, state transitions, and sequences.
 */
export function linearLayout(vertices: string[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const spacing = 140;
  const startX = 60;
  const centerY = 160;
  vertices.forEach((v, i) => {
    positions.set(v, { x: startX + i * spacing, y: centerY });
  });
  return positions;
}

/**
 * Hierarchical layout: nodes arranged in levels top-to-bottom.
 * Ideal for trees, DAGs, and reduction mappings.
 */
export function hierarchicalLayout(vertices: string[], edges: [string, string][]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  // Compute levels via BFS from sources (nodes with no incoming edges).
  const indegree = new Map<string, number>(vertices.map((v) => [v, 0]));
  for (const [, b] of edges) indegree.set(b, (indegree.get(b) ?? 0) + 1);
  const levels = new Map<string, number>();
  const queue = vertices.filter((v) => (indegree.get(v) ?? 0) === 0);
  for (const v of queue) levels.set(v, 0);
  while (queue.length > 0) {
    const v = queue.shift()!;
    const level = levels.get(v)!;
    for (const [a, b] of edges) {
      if (a === v && !levels.has(b)) {
        levels.set(b, level + 1);
        queue.push(b);
      }
    }
  }
  // Any remaining nodes (cycles) get the max level.
  const maxLevel = Math.max(0, ...levels.values());
  for (const v of vertices) {
    if (!levels.has(v)) levels.set(v, maxLevel);
  }
  // Group by level and assign positions.
  const byLevel = new Map<number, string[]>();
  for (const v of vertices) {
    const l = levels.get(v)!;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(v);
  }
  const vSpacing = 100;
  const hSpacing = 140;
  const startY = 60;
  for (const [level, nodes] of byLevel) {
    const totalWidth = (nodes.length - 1) * hSpacing;
    const startX = 60;
    nodes.forEach((v, i) => {
      positions.set(v, { x: startX + i * hSpacing, y: startY + level * vSpacing });
    });
  }
  return positions;
}

/**
 * Grid layout: nodes arranged in a grid.
 * Ideal for general undirected graphs.
 */
export function gridLayout(vertices: string[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(vertices.length));
  const spacing = 120;
  const startX = 60;
  const startY = 60;
  vertices.forEach((v, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    positions.set(v, { x: startX + col * spacing, y: startY + row * spacing });
  });
  return positions;
}

/**
 * Select the appropriate layout for a graph.
 */
export function selectLayout(
  vertices: string[],
  edges: [string, string][],
  layout?: "circular" | "linear" | "hierarchical" | "grid",
): Map<string, { x: number; y: number }> {
  switch (layout) {
    case "linear":
      return linearLayout(vertices);
    case "hierarchical":
      return hierarchicalLayout(vertices, edges);
    case "grid":
      return gridLayout(vertices);
    default:
      return circularLayout(vertices);
  }
}

export function toGraphData(
  raw: RawGraph,
  nodeState: (v: string) => GraphNode["state"] = () => "default",
  edgeState: (a: string, b: string) => GraphEdge["state"] = () => "default",
  layout?: "circular" | "linear" | "hierarchical" | "grid",
  edgeType?: "default" | "straight" | "step" | "smoothstep" | "bezier",
): GraphData {
  const positions = selectLayout(raw.vertices, raw.edges, layout);
  const nodes: GraphNode[] = raw.vertices.map((v) => {
    const p = positions.get(v)!;
    return { id: v, label: v, x: p.x, y: p.y, state: nodeState(v) };
  });
  const edges: GraphEdge[] = raw.edges.map(([a, b], i) => ({
    id: `e${i}`,
    source: a,
    target: b,
    state: edgeState(a, b),
  }));
  return { nodes, edges, layout, edgeType };
}

/** Stable edge id for a pair, matching the order-independent convention above. */
export function edgeId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Pick a deterministic layout that matches the graph's shape: a simple path
 * (n−1 edges, exactly two degree-1 vertices, the rest degree 2) reads best
 * left-to-right; anything else (cycles, triangles, general graphs) uses the
 * grid, which preserves topology honestly instead of drawing every graph as
 * a line.
 */
export function suggestLayout(raw: RawGraph): "linear" | "grid" {
  const n = raw.vertices.length;
  if (n <= 2) return "grid";
  const degree = new Map<string, number>(raw.vertices.map((v) => [v, 0]));
  for (const [a, b] of raw.edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  if (raw.edges.length === n - 1) {
    const degrees = [...degree.values()];
    const ones = degrees.filter((d) => d === 1).length;
    const twos = degrees.filter((d) => d === 2).length;
    if (ones === 2 && twos === n - 2) return "linear";
  }
  return "grid";
}
