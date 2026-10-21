/**
 * Graph rendering. The renderer never trusts raw block data blindly: nodes
 * and edges are validated here (ids, endpoints, coordinates) and invalid
 * pieces are dropped — an orphaned edge can never blank the canvas, and a
 * missing coordinate falls back to a deterministic grid position.
 *
 * Nodes use a custom `algo` node type rather than React Flow's built-in
 * default: the default node is styled with a fixed 150px width and top/bottom
 * handles, which overlaps nodes spaced 140–150px apart and drags edges through
 * the node bodies. The custom node hugs its label and exposes handles on all
 * four sides; each edge picks the handle pair nearest to its endpoints, so
 * left-to-right teaching graphs draw left-to-right edges and nothing routes
 * through an unrelated vertex.
 */
import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphData, GraphEdge, GraphNode } from "@shared/contract";

interface GraphBlockProps {
  graphId: string;
  data: GraphData;
  caption: string;
}

const NODE_STYLES: Record<GraphNode["state"], { bg: string; border: string; label: string }> = {
  default: { bg: "#f1f5f9", border: "#94a3b8", label: "Vertex" },
  active: { bg: "#dbeafe", border: "#2563eb", label: "Active" },
  selected: { bg: "#dcfce7", border: "#16a34a", label: "Selected" },
  covered: { bg: "#dcfce7", border: "#16a34a", label: "Covered" },
  uncovered: { bg: "#fef2f2", border: "#dc2626", label: "Uncovered" },
  cut: { bg: "#fef3c7", border: "#d97706", label: "Cut" },
  side_a: { bg: "#e0e7ff", border: "#4f46e5", label: "Side A" },
  side_b: { bg: "#fce7f3", border: "#db2777", label: "Side B" },
};

const EDGE_STYLES: Record<GraphEdge["state"], { stroke: string; dash?: string }> = {
  default: { stroke: "#94a3b8" },
  active: { stroke: "#2563eb" },
  covered: { stroke: "#16a34a" },
  uncovered: { stroke: "#dc2626", dash: "5 5" },
  cut: { stroke: "#d97706" },
  uncut: { stroke: "#94a3b8", dash: "2 4" },
};

const SIDES = [Position.Left, Position.Right, Position.Top, Position.Bottom] as const;
type Side = (typeof SIDES)[number];

/** Handle ids: `s-`/`t-` prefix + side name, e.g. `s-right`, `t-left`. */
const handleId = (kind: "s" | "t", side: Side) => `${kind}-${side}`;

/**
 * The teaching-graph node. Label-sized (never a fixed width), state colours
 * inline-styled, and one target + one source handle per side so any edge can
 * anchor on the side facing its neighbour. Handles are hidden: this graph is
 * a display, not an editor, and visible handle dots only add noise.
 */
type AlgoFlowNode = Node<{ label: string; state: GraphNode["state"] }, "algo">;

function AlgoNode({ data }: NodeProps<AlgoFlowNode>) {
  const style = NODE_STYLES[data.state] ?? NODE_STYLES.default;
  return (
    <div
      style={{
        background: style.bg,
        border: `2px solid ${style.border}`,
        borderRadius: "8px",
        padding: "6px 10px",
        fontSize: "13px",
        fontWeight: 600,
        minWidth: "44px",
        maxWidth: "168px",
        textAlign: "center",
        lineHeight: 1.3,
      }}
    >
      {SIDES.map((side) => (
        <Handle
          key={handleId("t", side)}
          id={handleId("t", side)}
          type="target"
          position={side}
          isConnectable={false}
          className="g7-handle"
        />
      ))}
      {data.label}
      {SIDES.map((side) => (
        <Handle
          key={handleId("s", side)}
          id={handleId("s", side)}
          type="source"
          position={side}
          isConnectable={false}
          className="g7-handle"
        />
      ))}
    </div>
  );
}

const NODE_TYPES = { algo: AlgoNode };

/**
 * Which side of each node an edge should leave from and arrive on: the sides
 * that face each other along the dominant axis between the two coordinates.
 * Diagonal pairs prefer the horizontal axis, matching left-to-right layouts.
 */
function edgeSides(sx: number, sy: number, tx: number, ty: number): { source: Side; target: Side } {
  const dx = tx - sx;
  const dy = ty - sy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { source: Position.Right, target: Position.Left } : { source: Position.Left, target: Position.Right };
  }
  return dy >= 0 ? { source: Position.Bottom, target: Position.Top } : { source: Position.Top, target: Position.Bottom };
}

interface ValidatedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  droppedEdges: number;
}

/**
 * Structural validation of the graph payload: unique node ids, finite
 * coordinates, edges that reference present nodes, no duplicate pairs.
 */
export function validateGraphData(data?: Partial<GraphData> | null): ValidatedGraph {
  if (!data || typeof data !== "object") {
    return { nodes: [], edges: [], droppedEdges: 0 };
  }
  const seen = new Set<string>();
  const nodes: GraphNode[] = [];
  const rawNodes = Array.isArray(data.nodes) ? data.nodes : [];
  const count = Math.max(1, rawNodes.length);
  const cols = Math.ceil(Math.sqrt(count));
  rawNodes.forEach((n, i) => {
    const node = n as GraphNode | undefined;
    if (!node || typeof node !== "object") return;
    const id = typeof node.id === "string" && node.id.length <= 64 ? node.id : "";
    if (!id || seen.has(id)) return;
    seen.add(id);
    const finiteX = typeof node.x === "number" && Number.isFinite(node.x);
    const finiteY = typeof node.y === "number" && Number.isFinite(node.y);
    nodes.push({
      id,
      label: typeof node.label === "string" && node.label.length > 0 ? node.label.slice(0, 32) : id,
      x: finiteX ? node.x : 80 + (i % cols) * 150,
      y: finiteY ? node.y : 80 + Math.floor(i / cols) * 120,
      state: NODE_STYLES[node.state] ? node.state : "default",
    });
  });

  const validEdges: GraphEdge[] = [];
  const seenPairs = new Set<string>();
  let droppedEdges = 0;
  const rawEdges = Array.isArray(data.edges) ? data.edges : [];
  for (const e of rawEdges as GraphEdge[]) {
    const edge = e as GraphEdge | undefined;
    if (!edge || typeof edge !== "object") {
      droppedEdges += 1;
      continue;
    }
    const source = typeof edge.source === "string" ? edge.source : "";
    const target = typeof edge.target === "string" ? edge.target : "";
    if (!source || !target || !seen.has(source) || !seen.has(target)) {
      droppedEdges += 1;
      continue;
    }
    const key = source < target ? `${source}|${target}` : `${target}|${source}`;
    // Duplicate (even reversed) connections are dropped for undirected clutter.
    if (!data.directed && seenPairs.has(key)) {
      droppedEdges += 1;
      continue;
    }
    seenPairs.add(key);
    validEdges.push({
      id: typeof edge.id === "string" && edge.id ? edge.id.slice(0, 64) : key,
      source,
      target,
      state: EDGE_STYLES[edge.state] ? edge.state : "default",
      caption: typeof edge.caption === "string" ? edge.caption.slice(0, 60) : undefined,
    });
  }
  return { nodes, edges: validEdges, droppedEdges };
}

export function GraphBlock({ data, caption }: GraphBlockProps) {
  const { nodes: safeNodes, edges: safeEdges, droppedEdges } = useMemo(() => validateGraphData(data), [data]);

  const rfNodes: Node[] = useMemo(
    () =>
      safeNodes.map((n) => ({
        id: n.id,
        type: "algo",
        position: { x: n.x, y: n.y },
        data: { label: n.label, state: n.state },
      })),
    [safeNodes],
  );

  // Coordinates by id for handle-side selection (validated nodes are finite).
  const positionOf = useMemo(() => {
    const byId = new Map(safeNodes.map((n) => [n.id, n]));
    return (id: string) => byId.get(id);
  }, [safeNodes]);

  const rfEdges: Edge[] = useMemo(
    () =>
      safeEdges.map((e) => {
        const from = positionOf(e.source);
        const to = positionOf(e.target);
        const sides =
          from && to ? edgeSides(from.x, from.y, to.x, to.y) : { source: Position.Right, target: Position.Left };
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: handleId("s", sides.source),
          targetHandle: handleId("t", sides.target),
          type: (data.edgeType && data.edgeType !== "default" ? data.edgeType : "straight") as Edge["type"],
          animated: e.state === "active" || e.state === "cut",
          style: {
            stroke: EDGE_STYLES[e.state]?.stroke ?? EDGE_STYLES.default.stroke,
            strokeWidth: e.state === "active" || e.state === "cut" ? 3 : 2,
          },
          ...(e.caption
            ? {
                label: e.caption,
                labelStyle: { fontSize: 11, fill: "#334155", fontWeight: 600 },
                labelBgStyle: { fill: "#ffffff" },
                labelBgPadding: [4, 2] as [number, number],
                labelBgBorderRadius: 4,
              }
            : {}),
        };
      }),
    [safeEdges, data.edgeType, positionOf],
  );

  const legend = useMemo(() => {
    const present = new Set<string>();
    safeNodes.forEach((n) => present.add(n.state));
    safeEdges.forEach((e) => present.add(e.state));
    return [...present].map((s) => ({
      state: s,
      ...(NODE_STYLES[s as GraphNode["state"]] ?? EDGE_STYLES[s as GraphEdge["state"]] ?? NODE_STYLES.default),
    }));
  }, [safeNodes, safeEdges]);

  if (safeNodes.length === 0) {
    // A requested graph that cannot be validated degrades to text, never to
    // an empty visual region (brief §6).
    return (
      <div className="block graph-block graph-block-unavailable">
        {caption && <p className="block-caption">{caption}</p>}
        <div className="graph-fallback" role="note">
          <p>A graph could not be rendered for this step (the visual data failed validation). The textual equivalent is the source of truth here:</p>
          <details className="graph-textual" open>
            <summary>Graph contents</summary>
            <p>
              Vertices: {(data.nodes ?? []).map((n) => n.label ?? n.id).join(", ")}.
              Edges: {(data.edges ?? []).map((e) => `${e.source}–${e.target}`).join(", ")}.
            </p>
          </details>
        </div>
      </div>
    );
  }

  return (
    <div className="block graph-block">
      {caption && <p className="block-caption">{caption}</p>}
      {droppedEdges > 0 && (
        <p className="graph-note" role="note">
          {droppedEdges} invalid edge{droppedEdges > 1 ? "s" : ""} omitted (referenced missing vertices).
        </p>
      )}
      <div className="graph-viewport" role="img" aria-label={`Graph visualization. ${caption}`}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.3}
          maxZoom={2.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Background gap={16} />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap pannable zoomable position="top-right" ariaLabel="Graph minimap" />
        </ReactFlow>
      </div>
      <div className="graph-legend" aria-label="Legend">
        {legend.map((l) => (
          <span key={l.state} className="legend-item">
            <span className="legend-swatch" style={{ background: l.bg, borderColor: l.border }} aria-hidden="true" />
            {l.label}
          </span>
        ))}
      </div>
      {/* Textual equivalent of the graph for screen readers and narrow screens. */}
      <details className="graph-textual">
        <summary>Text description of this graph</summary>
        <p>
          Vertices: {safeNodes.map((n) => `${n.label} (${n.state})`).join(", ")}.{" "}
          Edges: {safeEdges.map((e) => `${e.source}–${e.target} (${e.state})`).join(", ")}.
        </p>
      </details>
    </div>
  );
}
