/**
 * Scene player tests: the fixture data must be internally consistent (no edge
 * pointing at a missing vertex, no state keyed by an unknown id), and the
 * player must be fully usable and informative without animation.
 *
 * The fixture's *values* are verified against the real solvers by
 * server/tests/landing-scenes.test.ts; this suite covers what the client does
 * with them.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { landingScenes, sceneEdgeKey } from "@shared/landing-scenes";
import { AlgoScene } from "./AlgoScene";

/** Slugs of the real catalog the scenes must map onto. */
const CATALOG_SLUGS = [
  "polynomial-reductions",
  "formal-reductions",
  "cook-levin",
  "approximation-algorithms",
  "randomized-algorithms",
];

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.useRealTimers();
});

describe("scene fixtures are internally consistent", () => {
  it("covers every real topic exactly once", () => {
    expect(landingScenes.map((scene) => scene.topicId).sort()).toEqual([...CATALOG_SLUGS].sort());
  });

  it("never draws an edge whose endpoints are missing from the same graph", () => {
    for (const scene of landingScenes) {
      for (const graph of scene.graphs) {
        const ids = new Set(graph.nodes.map((node) => node.id));
        for (const edge of graph.edges) {
          expect(ids.has(edge.source), `${scene.id}: ${edge.source} missing`).toBe(true);
          expect(ids.has(edge.target), `${scene.id}: ${edge.target} missing`).toBe(true);
        }
      }
    }
  });

  it("keys every step's highlights to vertices and edges that exist", () => {
    for (const scene of landingScenes) {
      for (const step of scene.steps) {
        for (const [graphKey, state] of Object.entries(step.graphs ?? {})) {
          const graph = scene.graphs.find((g) => g.key === graphKey);
          expect(graph, `${scene.id} step ${step.step}: unknown graph "${graphKey}"`).toBeTruthy();
          const nodeIds = new Set(graph!.nodes.map((node) => node.id));
          const edgeKeys = new Set(graph!.edges.map((edge) => sceneEdgeKey(edge.source, edge.target)));
          for (const id of Object.keys(state.nodeStates)) {
            expect(nodeIds.has(id), `${scene.id} step ${step.step}: unknown vertex "${id}"`).toBe(true);
          }
          for (const key of Object.keys(state.edgeStates)) {
            expect(edgeKeys.has(key), `${scene.id} step ${step.step}: unknown edge "${key}"`).toBe(true);
          }
        }
        // Signals must name real edges (or the mapping arrow).
        for (const signal of step.signals ?? []) {
          if (signal === "mapping") {
            expect(scene.mappingLabel, `${scene.id}: mapping signal without a label`).toBeTruthy();
            continue;
          }
          const known = scene.graphs.some((graph) =>
            graph.edges.some((edge) => sceneEdgeKey(edge.source, edge.target) === signal),
          );
          expect(known, `${scene.id} step ${step.step}: signal "${signal}" is not an edge`).toBe(true);
        }
      }
    }
  });

  it("gives every step real explanatory text and a monotonic step number", () => {
    for (const scene of landingScenes) {
      expect(scene.steps.length).toBeGreaterThanOrEqual(2);
      expect(scene.steps.map((step) => step.step)).toEqual(scene.steps.map((_, i) => i + 1));
      for (const step of scene.steps) {
        expect(step.title.trim().length).toBeGreaterThan(0);
        expect(step.description.trim().length).toBeGreaterThan(20);
      }
    }
  });
});

describe("AlgoScene", () => {
  beforeEach(() => {
    stubMatchMedia(false);
  });

  it("renders one tab per scene and starts on the first step", () => {
    render(<AlgoScene />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(landingScenes.length);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("tabindex")).toBe("-1");
    expect(screen.getByText(`Step 1 of ${landingScenes[0].steps.length}`)).toBeTruthy();
  });

  it("switches scenes from the tab strip, including the tableau scene", () => {
    render(<AlgoScene />);
    fireEvent.click(screen.getByRole("tab", { name: "Cook–Levin" }));
    expect(screen.getByText("Cook–Levin tableau")).toBeTruthy();
    // The tableau has a text equivalent, so the drawing is not the only source.
    expect(screen.getByText("Text description of this tableau")).toBeTruthy();
    expect(screen.getByText(/t = 0: 0 1 _ _ _ _/)).toBeTruthy();
  });

  it("moves between steps with Next/Previous and returns with Reset", () => {
    render(<AlgoScene />);
    const next = screen.getByRole("button", { name: "Next →" });
    const previous = screen.getByRole("button", { name: "← Previous" });
    expect(previous.hasAttribute("disabled")).toBe(true);

    fireEvent.click(next);
    expect(screen.getByText(/^Step 2 of 4/)).toBeTruthy();
    expect(previous.hasAttribute("disabled")).toBe(false);

    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByText(/^Step 4 of 4/)).toBeTruthy();
    expect(next.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText(/^Step 1 of 4/)).toBeTruthy();
  });

  it("shows the solver's own step text, so the animation and the maths agree", () => {
    render(<AlgoScene />);
    fireEvent.click(screen.getByRole("tab", { name: "Vertex cover" }));
    // Step 1 of the vertex-cover trace, verbatim from the solver.
    expect(screen.getByText(/Start with an empty cover and all 3 edges uncovered/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByText(/Pick uncovered edge A–B/)).toBeTruthy();
    // The accumulated step table marks the current row.
    const table = document.querySelector(".lp-steptable")!;
    expect(within(table as HTMLElement).getByText("Uncovered edges")).toBeTruthy();
    expect(document.querySelectorAll(".lp-row-current")).toHaveLength(1);
  });

  it("names every graph state in the legend, so colour is never the only signal", () => {
    render(<AlgoScene />);
    fireEvent.click(screen.getByRole("tab", { name: "Vertex cover" }));
    // Step 1: everything is untouched.
    expect(screen.getByText("Untouched")).toBeTruthy();
    expect(screen.getByText("Uncovered")).toBeTruthy();
    // Step 2 picks A–B: selected vertices, the active edge, covered and
    // uncovered edges are all present and all named.
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));
    expect(screen.getByText("Selected")).toBeTruthy();
    expect(screen.getByText("Edge under consideration")).toBeTruthy();
    expect(screen.getByText("Covered")).toBeTruthy();
    expect(screen.getByText("Uncovered")).toBeTruthy();
  });

  it("shows one legend and one text description for a two-graph scene", () => {
    const { container } = render(<AlgoScene />);
    fireEvent.click(screen.getByRole("tab", { name: "Reductions" }));
    // The reduction scene draws two instances; the key and the text
    // equivalent are not duplicated per graph.
    expect(container.querySelectorAll(".lp-legend")).toHaveLength(1);
    expect(container.querySelectorAll(".lp-details")).toHaveLength(1);
    expect(container.querySelectorAll(".lp-graph-text li")).toHaveLength(2);
  });

  it("auto-advances on a deterministic timer and can be paused", () => {
    vi.useFakeTimers();
    render(<AlgoScene />);
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText(/Step 2 of 4 · paused/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // Paused: no further advance.
    expect(screen.getByText(/Step 2 of 4 · paused/)).toBeTruthy();
  });

  it("under reduced motion shows the completed step and never auto-advances", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    render(<AlgoScene />);
    expect(screen.getByText("Step 4 of 4 · motion reduced")).toBeTruthy();
    // No play/pause control at all when motion is reduced.
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    // Manual stepping still works.
    expect(screen.getByRole("button", { name: "← Previous" }).hasAttribute("disabled")).toBe(false);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText("Step 4 of 4 · motion reduced")).toBeTruthy();
  });

  it("keeps the drawing decorative and exposes the state as text", () => {
    const { container } = render(<AlgoScene />);
    for (const svg of container.querySelectorAll("svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
    expect(container.querySelectorAll(".lp-details").length).toBeGreaterThan(0);
  });
});
