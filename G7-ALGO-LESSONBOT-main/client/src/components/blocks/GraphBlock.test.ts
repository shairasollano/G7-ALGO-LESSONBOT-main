/**
 * Graph contract tests: the renderer's structural validation lifts an
 * invalid layout payload into a safe render (or a textual fallback) instead
 * of a blank canvas / orphaned edges.
 */
import { describe, expect, it } from "vitest";
import type { GraphData } from "@shared/contract";
import { validateGraphData } from "./GraphBlock";

const base = {
  nodes: [
    { id: "A", label: "A", x: 0, y: 0, state: "default" as const },
    { id: "B", label: "B", x: 100, y: 0, state: "covered" as const },
    { id: "C", label: "C", x: 200, y: 0, state: "uncovered" as const },
  ],
  edges: [
    { id: "e1", source: "A", target: "B", state: "default" as const },
    { id: "e2", source: "B", target: "C", state: "covered" as const },
  ],
  edgeType: "straight" as const,
};

describe("validateGraphData", () => {
  it("passes a valid payload through unchanged in content", () => {
    const v = validateGraphData(base);
    expect(v.nodes).toHaveLength(3);
    expect(v.edges).toHaveLength(2);
    expect(v.droppedEdges).toBe(0);
  });

  it("drops edges referencing missing vertices (no orphaned edges)", () => {
    const v = validateGraphData({
      ...base,
      edges: [...base.edges, { id: "e3", source: "X", target: "A", state: "default" as const }],
    });
    expect(v.edges).toHaveLength(2);
    expect(v.droppedEdges).toBe(1);
  });

  it("drops duplicate (and reversed) edges for undirected graphs", () => {
    const v = validateGraphData({
      ...base,
      edges: [...base.edges, { id: "e4", source: "A", target: "B", state: "default" as const }],
    });
    expect(v.edges).toHaveLength(2);
    expect(v.droppedEdges).toBe(1);
  });

  it("keeps duplicate directed edges when the graph is directed", () => {
    const v = validateGraphData({
      ...base,
      directed: true,
      edges: [...base.edges, { id: "e4", source: "A", target: "B", state: "default" as const }],
    });
    expect(v.edges).toHaveLength(3);
  });

  it("repairs non-finite coordinates with deterministic grid positions", () => {
    const v = validateGraphData({
      ...base,
      nodes: [
        { id: "A", label: "A", x: NaN, y: Infinity, state: "default" as const },
        { id: "B", label: "B", x: 50, y: 20, state: "default" as const },
      ],
    });
    expect(v.nodes[0].x).not.toBeNaN();
    expect(v.nodes[0].y).not.toBeNaN();
    expect(v.nodes[1].x).toBe(50);
    expect(v.nodes[1].y).toBe(20);
  });

  it("falls back node labels to ids and unknown states to default", () => {
    const v = validateGraphData({
      ...base,
      nodes: [
        { id: "A", label: "", x: 1, y: 1, state: "bogus" as never },
        { id: "", label: "orphan label drop", x: 2, y: 2, state: "default" as const },
      ],
    });
    expect(v.nodes).toHaveLength(1);
    expect(v.nodes[0].label).toBe("A");
    expect(v.nodes[0].state).toBe("default");
  });

  it("tolerates garbage payloads (returns empty structure)", () => {
    const v = validateGraphData(null);
    expect(v.nodes).toHaveLength(0);
    expect(v.edges).toHaveLength(0);
    const v2 = validateGraphData({ nodes: "nope", edges: 42 } as unknown as Partial<GraphData>);
    expect(v2.nodes).toHaveLength(0);
  });

  it("a fully invalid payload yields zero nodes -> textual fallback path", () => {
    const v = validateGraphData({ nodes: [{ id: "A", label: "A", x: NaN, y: 0, state: "default" }, { id: "A", label: "dup", x: 1, y: 1, state: "default" }] });
    expect(v.nodes).toHaveLength(1);
    expect(validateGraphData({ nodes: [], edges: [] }).nodes).toHaveLength(0);
  });
});
