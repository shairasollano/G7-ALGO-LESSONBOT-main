/**
 * The hero's example-in-motion: a decorative background graph plus a small
 * progress table, both showing the *same* real solver fixture — the landing
 * scene "vertex cover" (the curated path example A–B–C–D from
 * shared/landing-scenes.ts, verified against the solver by
 * server/tests/landing-scenes.test.ts).
 *
 *   - `HeroBackdrop` is an absolutely positioned layered field behind the
 *     hero: a fine technical grid and two soft accent glows (pure texture),
 *     a faint ornamental lattice of connections spanning the whole hero with
 *     two travelling signals, and the real fixture graph (the Vertex Cover
 *     path A–B–C–D) weaving through the open bottom band of the composition.
 *     It is `aria-hidden` and `pointer-events: none`, so it never participates
 *     in content sizing or click handling. Fixture edges draw progressively on
 *     mount (CSS dash animation), nodes illuminate in sequence with each step,
 *     and a signal travels the edge the solver is currently picking.
 *   - `HeroTicker` is the legible half: a compact table that fills one row per
 *     solver step, with a caption naming the step, and Play/Pause + Restart.
 *
 * Animation is one timeout chain (a few React updates per second, never a
 * per-frame value). `prefers-reduced-motion` freezes everything on the final
 * step — the completed graph and the complete table — and hides the controls,
 * because there is nothing left to control.
 */
import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { landingScenes, sceneEdgeKey, type SceneStep } from "@shared/landing-scenes";
import { edgeStateOf, nodeStateOf } from "./AlgoScene";
import { IconPause, IconPlay, IconRestart } from "./icons";
import { usePrefersReducedMotion } from "./use-motion";

const STEP_MS = 2400;
const HOLD_MS = 3000;

/** The one scene both halves of the hero animation draw. */
const scene = landingScenes.find((entry) => entry.id === "vertex-cover") ?? landingScenes[0];
const GRAPH = scene.graphs[0];

/**
 * The fixture's own topology (A–B–C–D) laid across the wide decorative
 * field. Same vertices, same edges, same labels — only the coordinates are
 * chosen for this layer: the chain weaves through the open top band of the
 * composition, above the headline and the scene tabs, where it is always
 * visible on the first screen and never crosses text or controls.
 */
const BG_NODES = [
  { id: "A", x: 205, y: 44 },
  { id: "B", x: 455, y: 30 },
  { id: "C", x: 705, y: 50 },
  { id: "D", x: 1010, y: 32 },
];

/**
 * Ornamental lattice geometry: a brick-offset grid across the whole field,
 * jittered by a fixed hash so it never reads as a table. Purely decorative —
 * no labels, no states, no data claim; the fixture chain above it is the
 * only thing in the hero that claims to describe a real example.
 */
const MESH_COLS = 10;
const MESH_ROWS = 4;
const MESH_SPACING_X = 126;
const MESH_SPACING_Y = 200;
const meshJitter = (r: number, c: number) => ((r * 7 + c * 13) % 5) * 7 - 14;

const MESH_NODES: { x: number; y: number }[][] = Array.from({ length: MESH_ROWS }, (_, r) =>
  Array.from({ length: MESH_COLS }, (_, c) => ({
    x: 34 + c * MESH_SPACING_X + (r % 2 ? 33 : 0) + meshJitter(r, c),
    y: 108 + r * MESH_SPACING_Y + meshJitter(c, r),
  })),
);

interface MeshEdge {
  a: { x: number; y: number };
  b: { x: number; y: number };
  /** Carries one of the two travelling signals. */
  signal?: boolean;
}

const MESH_EDGES: MeshEdge[] = [];
for (let r = 0; r < MESH_ROWS; r += 1) {
  for (let c = 0; c < MESH_COLS; c += 1) {
    if (c + 1 < MESH_COLS) {
      MESH_EDGES.push({
        a: MESH_NODES[r][c],
        b: MESH_NODES[r][c + 1],
        // Top band (over the headline's whitespace) and bottom band (below
        // the ticker): the two lattice rows whose signals are always on
        // screen rather than behind an opaque surface.
        signal: (r === 0 && c === 3) || (r === MESH_ROWS - 1 && c === 1),
      });
    }
    if (r + 1 < MESH_ROWS) {
      MESH_EDGES.push({ a: MESH_NODES[r][c], b: MESH_NODES[r + 1][c] });
      if (c + 1 < MESH_COLS && (r + c) % 2 === 0) {
        MESH_EDGES.push({ a: MESH_NODES[r][c], b: MESH_NODES[r + 1][c + 1] });
      }
    }
  }
}

/**
 * The hero animates over the *progress* steps of the run — the ones whose table
 * shares the `Current cover | Uncovered edges` shape and that the backdrop
 * graph illuminates. The solver's final "guarantee" step carries a different
 * table (a summary, not a per-pick row) and no topology change, so it is left
 * to the scene player below rather than squeezed into a 100px ticker bay.
 */
const PROGRESS_STEPS = scene.steps.filter((entry) => entry.table?.columns[0] === "Current cover");

/** Advance through the solver's own steps; returns the live animation state. */
export function useHeroExample() {
  const reducedMotion = usePrefersReducedMotion();
  const steps = PROGRESS_STEPS;
  const [phase, setPhase] = useState(0);
  const [paused, setPaused] = useState(false);
  const active = Math.min(phase, steps.length - 1);

  // Reduced motion: no auto-advance, the completed run shown once.
  useEffect(() => {
    if (reducedMotion) setPhase(steps.length - 1);
  }, [reducedMotion, steps.length]);

  // One timeout chain for the whole loop — restart happens at a step boundary.
  useEffect(() => {
    if (reducedMotion || paused) return;
    const isLast = active >= steps.length - 1;
    const timer = window.setTimeout(() => setPhase(isLast ? 0 : active + 1), isLast ? HOLD_MS : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [active, paused, reducedMotion, steps.length]);

  const togglePause = useCallback(() => setPaused((current) => !current), []);
  const restart = useCallback(() => {
    setPaused(false);
    setPhase(0);
  }, []);

  return { step: steps[active], phase: active, paused, reducedMotion, togglePause, restart };
}

/**
 * Decorative field behind the hero, in three stacked layers: the grid + glows
 * (texture), the ornamental lattice (the secondary network that carries the
 * composition through the centre and the left), and the real fixture chain
 * (drawn from the fixture's actual node/edge states, so the graph and the
 * ticker table always describe the same step of the same example).
 *
 * The field's viewBox is the hero's own wide aspect and it is *sliced* to
 * cover, so the decoration fills whatever hero shape the breakpoint produces
 * without ever changing the hero's size. Everything decorative is drawn at
 * hairline contrast; the labelled fixture chain is the only part allowed to
 * read as "a graph", and it lives in the open bands of the composition —
 * below the opaque ticker and scene panel — where it cannot sit under text.
 */
export function HeroBackdrop({ step, paused }: { step: SceneStep; paused: boolean }) {
  const signalKeys = new Set(step.signals ?? []);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gridId = `lp-grid-${uid}`;
  const glowId = `lp-glow-${uid}`;
  const edgeList = GRAPH.edges.map((edge) => `${edge.source}–${edge.target}`).join(", ");

  return (
    <div className="lp-hero-bg" data-paused={paused ? "true" : "false"} aria-hidden="true">
      <svg
        className="lp-hero-bg-svg"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <pattern id={gridId} width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M48 0 L 0 0 0 48" fill="none" stroke="var(--lp-line)" strokeWidth="1" />
          </pattern>
          <radialGradient id={glowId}>
            <stop offset="0%" stopColor="var(--lp-accent)" stopOpacity="0.13" />
            <stop offset="55%" stopColor="var(--lp-accent)" stopOpacity="0.05" />
            <stop offset="100%" stopColor="var(--lp-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Texture: graph paper, in the page's own rule colour. */}
        <rect className="lp-bg-grid" width="1200" height="800" fill={`url(#${gridId})`} />

        {/* Soft accent lighting behind the copy and behind the scene panel. */}
        <ellipse cx="950" cy="330" rx="420" ry="360" fill={`url(#${glowId})`} />
        <ellipse cx="250" cy="420" rx="360" ry="320" fill={`url(#${glowId})`} opacity="0.7" />

        {/* The secondary network: hairline connections spanning the hero. */}
        <g className="lp-bg-mesh">
          {MESH_EDGES.map((edge, index) => (
            <g key={`mesh-e${index}`}>
              <line
                className="lp-bg-mesh-edge"
                style={{ "--i": index } as CSSProperties}
                pathLength={1}
                x1={edge.a.x}
                y1={edge.a.y}
                x2={edge.b.x}
                y2={edge.b.y}
              />
              {edge.signal && (
                <line className="lp-signal lp-bg-signal" x1={edge.a.x} y1={edge.a.y} x2={edge.b.x} y2={edge.b.y} />
              )}
            </g>
          ))}
          {MESH_NODES.flat().map((node, index) => (
            <circle key={`mesh-n${index}`} className="lp-bg-mesh-node" cx={node.x} cy={node.y} r={2.5} />
          ))}
        </g>

        {/* The real fixture graph, with the solver's own step states. */}
        <g className="lp-bg-fixture">
          <g className="lp-bg-edges">
            {GRAPH.edges.map((edge, index) => {
              const a = BG_NODES.find((node) => node.id === edge.source)!;
              const b = BG_NODES.find((node) => node.id === edge.target)!;
              const state = edgeStateOf(step, GRAPH.key, edge.source, edge.target);
              const key = sceneEdgeKey(edge.source, edge.target);
              return (
                <g key={key}>
                  <line
                    className={`lp-bg-edge lp-edge-${state}`}
                    style={{ "--i": index } as CSSProperties}
                    pathLength={1}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                  />
                  {signalKeys.has(key) && (
                    <line className="lp-signal lp-bg-signal" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                  )}
                </g>
              );
            })}
          </g>
          <g className="lp-bg-nodes">
            {BG_NODES.map((node, index) => {
              const state = nodeStateOf(step, GRAPH.key, node.id);
              const label = GRAPH.nodes.find((fixture) => fixture.id === node.id)?.label ?? node.id;
              return (
                <g key={node.id} className={`lp-bg-node lp-node-${state}`} style={{ "--i": index } as CSSProperties}>
                  <circle className="lp-node-ring" cx={node.x} cy={node.y} r={13} />
                  <text className="lp-node-label" x={node.x} y={node.y}>
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        </g>

        {/* The topic's own mathematics, read off the fixture's edge set, in
            the open band below the ticker. */}
        <text className="lp-bg-matrix" x="210" y="778">
          {`E = {${edgeList}}`}
        </text>
      </svg>
    </div>
  );
}

/**
 * The legible half: rows accumulate one solver step at a time (the same
 * accumulate-by-columns logic as the scene player's step table), each new
 * row's cells fading in left to right. Row keys are stable, so only genuinely
 * new cells animate.
 */
export function HeroTicker({
  step,
  phase,
  paused,
  reducedMotion,
  onTogglePause,
  onRestart,
}: {
  step: SceneStep;
  phase: number;
  paused: boolean;
  reducedMotion: boolean;
  onTogglePause: () => void;
  onRestart: () => void;
}) {
  const rows = useMemo(() => {
    const table = step.table;
    if (!table) return [];
    const signature = table.columns.join("|");
    const collected: { cells: (string | number)[]; sourceIndex: number; rowInStep: number }[] = [];
    for (let i = 0; i <= phase; i++) {
      const earlier = PROGRESS_STEPS[i]?.table;
      if (!earlier || earlier.columns.join("|") !== signature) continue;
      earlier.rows.forEach((row, r) => collected.push({ cells: row, sourceIndex: i, rowInStep: r }));
    }
    return collected;
  }, [phase, step]);

  const columns = step.table?.columns ?? [];

  return (
    <aside className="lp-hero-ticker" aria-label="Example in motion: the Vertex Cover approximation">
      <div className="lp-hero-ticker-head">
        <p className="lp-hero-ticker-label">Example in motion</p>
        {!reducedMotion && (
          <div className="lp-hero-ticker-controls">
            <button
              type="button"
              className="lp-btn lp-btn-quiet lp-btn-with-icon"
              onClick={onTogglePause}
              aria-label={paused ? "Play the hero example" : "Pause the hero example"}
            >
              {paused ? <IconPlay /> : <IconPause />}
              {paused ? "Play" : "Pause"}
            </button>
            <button
              type="button"
              className="lp-btn lp-btn-quiet lp-btn-with-icon"
              onClick={onRestart}
              aria-label="Restart the hero example"
            >
              <IconRestart />
              Restart
            </button>
          </div>
        )}
      </div>
      <p className="lp-hero-ticker-caption">
        The 2-approximation for <strong>Vertex Cover</strong> on {GRAPH.label} — step {step.step}: {step.title}
      </p>
      <div className="lp-hero-ticker-tablewrap">
        <table className="lp-steptable lp-hero-ticker-table" aria-label="Vertex Cover progress, one row per solver step">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.sourceIndex}-${row.rowInStep}`} aria-current={row.sourceIndex === phase ? true : undefined}>
                {row.cells.map((cell, c) => (
                  <td key={c} className="lp-ticker-cell" style={{ "--c": c } as CSSProperties}>
                    {String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
