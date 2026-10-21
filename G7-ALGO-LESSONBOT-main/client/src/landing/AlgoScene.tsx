/**
 * The animated computational scene player.
 *
 * Five scenes, one per supported topic, each showing a *coherent* example:
 * the topology, the per-step highlights, the step text and the step tables all
 * come from `shared/landing-scenes.ts`, which is generated from real solver
 * runs and re-verified against those solvers by the server test suite. Nothing
 * on this page is a decorative invention.
 *
 * Animation is deliberately cheap and interruptible:
 *   - React state only ever holds the active scene and step (a few updates per
 *     second), never a per-frame value.
 *   - Between steps, colour/width changes are animated by CSS transitions.
 *   - Travelling signals are CSS keyframes on a dash offset.
 *   - `prefers-reduced-motion: reduce` stops auto-advance, shows the completed
 *     final state, and leaves Prev/Next/Reset fully usable.
 * The SVG is decorative (`aria-hidden`); the same information is present as
 * real text — the step heading, the step description, the step table, the
 * legend, and a text description of every graph and tableau.
 */
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  cookLevinTableau,
  landingScenes,
  sceneEdgeKey,
  type Scene,
  type SceneEdgeState,
  type SceneGraph,
  type SceneNodeState,
  type SceneStep,
  type SceneTableau,
} from "@shared/landing-scenes";
import { TabStrip, tabIds } from "./TabStrip";
import { IconPause, IconPlay, IconRestart } from "./icons";
import { usePrefersReducedMotion } from "./use-motion";

/** How long each step is shown, and how long the last step is held. */
const STEP_MS = 1500;
const HOLD_MS = 2600;

const NODE_RADIUS = 21;

interface AlgoSceneProps {
  /** Scenes to play. Defaults to every landing scene, in display order. */
  scenes?: Scene[];
}

/**
 * Axis-aligned viewBox with padding, derived from the fixture's coordinates.
 * Pad is 26 rather than a roomier value: every node radius is 21, so 26 still
 * clears the widest ring and its stroke while keeping the drawn graph large
 * enough that node labels stay legible in the narrow (320px) scene column.
 */
function viewBoxFor(nodes: { x: number; y: number }[], pad = 26): string {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return `${minX} ${minY} ${Math.max(...xs) + pad - minX} ${Math.max(...ys) + pad - minY}`;
}

function nodeStateOf(step: SceneStep | undefined, graphKey: string, id: string): SceneNodeState {
  return step?.graphs?.[graphKey]?.nodeStates[id] ?? "default";
}

function edgeStateOf(step: SceneStep | undefined, graphKey: string, a: string, b: string): SceneEdgeState {
  return step?.graphs?.[graphKey]?.edgeStates[sceneEdgeKey(a, b)] ?? "default";
}

export { edgeStateOf, nodeStateOf };

/**
 * A single graph drawing. Node and edge states drive CSS classes; each state
 * also changes shape (dashed vs solid, ring weight), so nothing is conveyed by
 * colour alone. The legend below names every state in words.
 */
export function GraphView({
  graph,
  step,
  signals,
}: {
  graph: SceneGraph;
  step?: SceneStep;
  signals: string[];
}) {
  const viewBox = viewBoxFor(graph.nodes);
  const signalKeys = new Set(signals);

  return (
    <div className="lp-graphwrap">
      <p className="lp-graphlabel">{graph.label}</p>
      <svg className="lp-graph" viewBox={viewBox} role="presentation" aria-hidden="true" focusable="false">
        <g className="lp-edges">
          {graph.edges.map((edge) => {
            const state = edgeStateOf(step, graph.key, edge.source, edge.target);
            const key = sceneEdgeKey(edge.source, edge.target);
            const a = graph.nodes.find((n) => n.id === edge.source)!;
            const b = graph.nodes.find((n) => n.id === edge.target)!;
            return (
              <g key={key}>
                <line className={`lp-edge lp-edge-${state}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                {signalKeys.has(key) && (
                  <line className="lp-signal" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                )}
              </g>
            );
          })}
        </g>
        <g className="lp-nodes">
          {graph.nodes.map((node) => {
            const state = nodeStateOf(step, graph.key, node.id);
            return (
              <g key={node.id} className={`lp-node lp-node-${state}`}>
                <circle className="lp-node-ring" cx={node.x} cy={node.y} r={NODE_RADIUS} />
                {state === "side_a" && <circle className="lp-node-mark" cx={node.x} cy={node.y} r={NODE_RADIUS - 6} />}
                <text className="lp-node-label" x={node.x} y={node.y}>
                  {node.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

const STATE_LABELS: Record<string, string> = {
  default: "Untouched",
  active: "Edge under consideration",
  selected: "Selected",
  covered: "Covered",
  uncovered: "Uncovered",
  cut: "Crossing the cut",
  uncut: "Inside one side",
  side_a: "Side A",
  side_b: "Side B",
};

/**
 * One legend for the whole scene. States are collected across every graph in
 * the current step, so a two-graph scene gets a single key instead of a
 * duplicate pair, and every state that is actually drawn is named in words.
 */
function SceneLegend({ scene, step }: { scene: Scene; step?: SceneStep }) {
  const states = useMemo(() => {
    const present = new Set<string>();
    for (const graph of scene.graphs) {
      for (const node of graph.nodes) present.add(nodeStateOf(step, graph.key, node.id));
      for (const edge of graph.edges) present.add(edgeStateOf(step, graph.key, edge.source, edge.target));
    }
    return [...present];
  }, [scene, step]);

  if (states.length === 0) return null;

  return (
    <ul className="lp-legend" aria-label="Graph key">
      {states.map((state) => (
        <li key={state} className="lp-legend-item">
          <span className={`lp-swatch lp-swatch-${state}`} aria-hidden="true" />
          {STATE_LABELS[state] ?? state}
        </li>
      ))}
    </ul>
  );
}

/** Text equivalent of every graph in the scene, mirroring the chat's block. */
function SceneGraphText({ scene, step }: { scene: Scene; step?: SceneStep }) {
  if (scene.graphs.length === 0) return null;
  return (
    <details className="lp-details">
      <summary>
        Text description of {scene.graphs.length > 1 ? "these graphs" : "this graph"}
      </summary>
      <ul className="lp-graph-text">
        {scene.graphs.map((graph) => (
          <li key={graph.key}>
            <strong>{graph.label}.</strong> Vertices:{" "}
            {graph.nodes
              .map((n) => `${n.label} (${STATE_LABELS[nodeStateOf(step, graph.key, n.id)] ?? "default"})`)
              .join(", ")}
            . Edges:{" "}
            {graph.edges
              .map(
                (e) =>
                  `${e.source}–${e.target} (${STATE_LABELS[edgeStateOf(step, graph.key, e.source, e.target)] ?? "default"})`,
              )
              .join(", ")}
            .
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The bounded Cook–Levin tableau, drawn from the fixture's real machine run. */
export function TableauView({ tableau, step }: { tableau: SceneTableau; step?: SceneStep }) {
  const rows = useMemo(
    () => cookLevinTableau(tableau.machine, tableau.input, tableau.stepBound),
    [tableau.machine, tableau.input, tableau.stepBound],
  );
  const columns = rows[0]?.cells.length ?? 0;
  const annotation = step?.tableau;
  const filled = Boolean(annotation?.filled);
  const cellW = 54;
  const cellH = 44;
  const gutter = 30;
  const headerH = 22;
  const width = gutter + columns * cellW;
  const height = headerH + rows.length * cellH;

  // Where the machine actually accepts, read off the simulated run.
  const acceptAt = useMemo(() => {
    for (const row of rows) {
      const col = row.cells.findIndex((c) => c.head === tableau.machine.acceptState);
      if (col >= 0) return { time: row.time, col };
    }
    return null;
  }, [rows, tableau.machine.acceptState]);

  const window = annotation?.window;
  // The blank tape symbol, read off the simulated run rather than assumed.
  const blankSymbol = rows[0]?.cells[tableau.input.length]?.symbol ?? null;

  return (
    <div className="lp-graphwrap">
      <p className="lp-graphlabel">{tableau.caption}</p>
      <svg
        className="lp-tableau"
        viewBox={`0 0 ${width} ${height}`}
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        {Array.from({ length: columns }, (_, h) => (
          <text key={`h${h}`} className="lp-tableau-axis" x={gutter + h * cellW + cellW / 2} y={headerH - 8}>
            h={h}
          </text>
        ))}
        {rows.map((row, r) => (
          <g key={row.time}>
            <text className="lp-tableau-axis" x={gutter - 8} y={headerH + r * cellH + cellH / 2 + 4} textAnchor="end">
              t={row.time}
            </text>
            {row.cells.map((cell, c) => {
              const inWindow =
                window !== undefined &&
                (r === window.row || r === window.row + 1) &&
                Math.abs(c - window.col) <= 1;
              const isAccept = acceptAt !== null && acceptAt.time === row.time && acceptAt.col === c;
              const classes = ["lp-cell"];
              if (blankSymbol !== null && cell.symbol === blankSymbol) classes.push("lp-cell-blank");
              if (annotation?.initialConfig && row.time === 0) classes.push("lp-cell-initial");
              if (inWindow) classes.push("lp-cell-window");
              if (annotation?.accept && isAccept) classes.push("lp-cell-accept");
              return (
                <g key={c} className={classes.join(" ")}>
                  <rect x={gutter + c * cellW} y={headerH + r * cellH} width={cellW} height={cellH} rx={4} />
                  {filled && (
                    <text className="lp-cell-symbol" x={gutter + c * cellW + cellW / 2} y={headerH + r * cellH + 22}>
                      {cell.symbol}
                    </text>
                  )}
                  {filled && cell.head !== null && (
                    <>
                      <text
                        className="lp-cell-head"
                        x={gutter + c * cellW + cellW / 2}
                        y={headerH + r * cellH + 37}
                      >
                        {cell.head}
                      </text>
                      <path
                        className="lp-cell-caret"
                        d={`M ${gutter + c * cellW + cellW / 2 - 4} ${headerH + r * cellH + 6} l 4 5 l 4 -5 z`}
                      />
                    </>
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Step table, accumulating earlier rows when the fixture asks for it. */
function StepTable({ scene, stepIndex }: { scene: Scene; stepIndex: number }) {
  const table = scene.steps[stepIndex]?.table;
  if (!table) return null;
  const signature = table.columns.join("|");
  const rows: { cells: (string | number)[]; current: boolean }[] = [];
  if (table.accumulate) {
    for (let i = 0; i <= stepIndex; i++) {
      const earlier = scene.steps[i].table;
      if (!earlier || earlier.columns.join("|") !== signature) continue;
      for (const row of earlier.rows) rows.push({ cells: row, current: i === stepIndex });
    }
  } else {
    for (const row of table.rows) rows.push({ cells: row, current: true });
  }
  if (rows.length === 0) return null;

  return (
    <div className="lp-steptable-wrap">
      <table className="lp-steptable">
        {table.caption && <caption>{table.caption}</caption>}
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={row.current ? "lp-row-current" : undefined} aria-current={row.current || undefined}>
              {row.cells.map((cell, c) => (
                <td key={c}>{String(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.accumulate && <p className="lp-steptable-note">The current step's row is marked.</p>}
    </div>
  );
}

export function AlgoScene({ scenes = landingScenes }: AlgoSceneProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [sceneIndex, setSceneIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const baseId = useId();

  const scene = scenes[sceneIndex] ?? scenes[0];
  const stepCount = scene.steps.length;
  const currentStepIndex = Math.min(stepIndex, stepCount - 1);
  const step = scene.steps[currentStepIndex];

  // Reduced motion: no auto-advance, and each scene is shown complete.
  useEffect(() => {
    if (reducedMotion) setStepIndex(scene.steps.length - 1);
  }, [reducedMotion, scene.steps.length]);

  const selectScene = useCallback(
    (index: number) => {
      const next = scenes[index];
      if (!next) return;
      setSceneIndex(index);
      setStepIndex(reducedMotion ? next.steps.length - 1 : 0);
      setPaused(false);
    },
    [reducedMotion, scenes],
  );

  // The whole animation is one timeout chain — no per-frame React updates.
  useEffect(() => {
    if (reducedMotion || paused) return;
    const isLastStep = currentStepIndex >= stepCount - 1;
    const timer = window.setTimeout(
      () => {
        if (isLastStep) {
          const next = (sceneIndex + 1) % scenes.length;
          setSceneIndex(next);
          setStepIndex(0);
        } else {
          setStepIndex(currentStepIndex + 1);
        }
      },
      isLastStep ? HOLD_MS : STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [currentStepIndex, paused, reducedMotion, sceneIndex, scenes.length, stepCount]);

  // Tab strip keyboard behaviour lives in TabStrip (shared with the demo).
  const graphSignals = (step.signals ?? []).filter((key) => key !== "mapping");
  const mappingFlowing = Boolean(step.signals?.includes("mapping"));
  const panelIds = tabIds(baseId, scene.id);

  return (
    <div className="lp-scene">
      <TabStrip
        baseId={baseId}
        ariaLabel="Algorithm scenes"
        activeIndex={sceneIndex}
        onSelect={selectScene}
        tabs={scenes.map((s) => ({ id: s.id, label: s.tabLabel }))}
      />

      {/*
        The panel has a fixed height (set by landing.css per breakpoint) so the
        hero's dimensions never depend on which scene or step is showing: the
        head (title), the visual (bounded canvas) and the controls are all
        fixed, and everything that legitimately varies in length — the step
        text and table first, then the caption, the legend and the text
        descriptions — lives in one scrollable region between them.
      */}
      <div className="lp-scene-panel" role="tabpanel" id={panelIds.panel} aria-labelledby={panelIds.tab}>
        <div className="lp-scene-head">
          <h3 className="lp-scene-title">{scene.title}</h3>
        </div>

        <div className={`lp-scene-visual ${scene.graphs.length > 1 ? "lp-scene-visual-dual" : ""}`}>
          {scene.tableau && <TableauView tableau={scene.tableau} step={step} />}
          {scene.graphs.map((graph, i) => (
            <Fragment key={graph.key}>
              {i > 0 && scene.mappingLabel && (
                <div className="lp-mapping" data-flow={mappingFlowing ? "on" : "off"}>
                  <span className="lp-mapping-label">{scene.mappingLabel}</span>
                  <span className="lp-mapping-line" aria-hidden="true">
                    <span className="lp-mapping-track" />
                    <span className="lp-mapping-arrow">⟶</span>
                  </span>
                </div>
              )}
              <div className="lp-scene-visual-item">
                <GraphView graph={graph} step={step} signals={graphSignals} />
              </div>
            </Fragment>
          ))}
        </div>

        {/* The scroll region leads with the *current step* — the content that
            changes as the scene plays — so at a 900px-tall viewport the step
            counter, title and body are on screen without scrolling. Caption,
            legend and the text descriptions follow as reference material. */}
        <div className="lp-scene-scroll" tabIndex={0} aria-label={`${scene.title}: step, caption and key details`}>
          <div className="lp-scene-step">
            <p className="lp-step-counter">
              Step {step.step} of {stepCount}
              {paused && !reducedMotion ? " · paused" : ""}
              {reducedMotion ? " · motion reduced" : ""}
            </p>
            <h4 className="lp-step-title">{step.title}</h4>
            <p className="lp-step-body">{step.description}</p>
            <StepTable scene={scene} stepIndex={currentStepIndex} />
          </div>

          <p className="lp-scene-caption">{scene.caption}</p>

          <div className="lp-scene-meta">
            <SceneLegend scene={scene} step={step} />
            <SceneGraphText scene={scene} step={step} />
            {scene.tableau && (
              <details className="lp-details">
                <summary>Text description of this tableau</summary>
                <ul className="lp-tableau-text">
                  {cookLevinTableau(scene.tableau.machine, scene.tableau.input, scene.tableau.stepBound).map((row) => {
                    const headCell = row.cells.findIndex((c) => c.head !== null);
                    return (
                      <li key={row.time}>
                        t = {row.time}: {row.cells.map((c) => c.symbol).join(" ")}
                        {headCell >= 0 ? ` — head at cell ${headCell} in ${row.cells[headCell].head}` : " — halted"}
                      </li>
                    );
                  })}
                </ul>
              </details>
            )}
            {step.tableau && (
              <ul className="lp-annotations">
                {step.tableau.initialConfig && (
                  <li>Initial configuration: row t = 0 spells the input with blanks elsewhere.</li>
                )}
                {step.tableau.window && (
                  <li>
                    Transition window: rows t = {step.tableau.window.row}–{step.tableau.window.row + 1}, cells h ={" "}
                    {step.tableau.window.col - 1}–{step.tableau.window.col + 1}.
                  </li>
                )}
                {step.tableau.accept && (
                  <li>
                    The accepting condition requires the head to reach {scene.tableau?.machine.acceptState} within T
                    steps.
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="lp-scene-controls">
          <button
            type="button"
            className="lp-btn lp-btn-quiet"
            onClick={() => {
              setPaused(true);
              setStepIndex(Math.max(0, currentStepIndex - 1));
            }}
            disabled={currentStepIndex === 0}
          >
            ← Previous
          </button>
          <button
            type="button"
            className="lp-btn lp-btn-quiet"
            onClick={() => {
              setPaused(true);
              setStepIndex(Math.min(stepCount - 1, currentStepIndex + 1));
            }}
            disabled={currentStepIndex >= stepCount - 1}
          >
            Next →
          </button>
          <button
            type="button"
            className="lp-btn lp-btn-quiet"
            onClick={() => {
              setPaused(true);
              setStepIndex(0);
            }}
          >
            <IconRestart />
            Reset
          </button>
          {!reducedMotion && (
            <button type="button" className="lp-btn lp-btn-quiet" onClick={() => setPaused((p) => !p)}>
              {paused ? <IconPlay /> : <IconPause />}
              {paused ? "Play" : "Pause"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
