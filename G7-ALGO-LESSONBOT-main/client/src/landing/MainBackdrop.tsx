/**
 * Decorative background for the landing page's main column.
 *
 * Below the hero, the page is a 1200px centred column (`.lp-section`,
 * `.lp-rail`) inside a full-width `<main>`, so on wide viewports the left and
 * right margins are bare paper. This layer fills that space without touching
 * the layout: it is absolutely positioned inside `#lp-main`, `aria-hidden`,
 * `pointer-events: none`, and painted *behind* the real content (the sections
 * above it in z-order), so it can never affect sizing, hit-testing or reading.
 *
 * Two kinds of decoration, both purely ornamental — no labels, no states, no
 * data claim:
 *
 *   - The dotted grid and the soft accent glows live in CSS (landing.css);
 *     the dot pattern covers the whole of main and eases to ~1/3 strength
 *     behind the centre column.
 *   - Each gutter carries a sparse graph-network strip: a hand-authored tile
 *     (nodes + hairline edges) repeated vertically by an SVG pattern, so the
 *     strip covers the page's full height at a stable 1:1 scale however tall
 *     it grows. The left and right tiles are written by hand rather than
 *     mirrored, so the two sides complement without matching.
 *
 * Animation is CSS-only (no React state, no timers): edges draw in once on
 * mount using the hero backdrop's own `lp-bg-draw`, one signal per tile
 * travels one edge slowly, and a couple of nodes breathe with a soft accent
 * highlight. Under `prefers-reduced-motion` the signals disappear and the
 * draw-in is skipped — the dot grid and the finished static network remain.
 */
import { useId, type CSSProperties, type ReactNode } from "react";

/** Tile size in viewBox units; the pattern repeats every TILE_H vertically. */
const TILE_W = 200;
const TILE_H = 1000;

type Point = readonly [number, number];

interface NetworkEdge {
  from: Point;
  to: Point;
  /** Carries a slow travelling signal. */
  signal?: boolean;
  /** Only drawn on the widest screens — the medium-width density ease. */
  extra?: boolean;
  /** Crosses the tile seam. Drawn a second time one tile higher, so the
      edge continues across the pattern's vertical repeat. */
  wrap?: boolean;
}

interface NetworkTile {
  nodes: { x: number; y: number; hi?: boolean }[];
  edges: NetworkEdge[];
}

/**
 * The left gutter's network: a denser, more triangulated fragment. Coordinates
 * are hand-placed inside the tile; the final edge wraps from the bottom node
 * up towards the next tile's top node (drawn as its shifted twin below).
 */
const LEFT_TILE: NetworkTile = {
  nodes: [
    { x: 24, y: 78 },
    { x: 116, y: 36 },
    { x: 170, y: 140 },
    { x: 70, y: 206, hi: true },
    { x: 26, y: 328 },
    { x: 140, y: 378 },
    { x: 84, y: 500 },
    { x: 176, y: 562 },
    { x: 36, y: 636 },
    { x: 120, y: 722 },
    { x: 162, y: 838, hi: true },
    { x: 56, y: 908 },
  ],
  edges: [
    { from: [24, 78], to: [116, 36], signal: true },
    { from: [116, 36], to: [170, 140] },
    { from: [24, 78], to: [70, 206] },
    { from: [170, 140], to: [70, 206] },
    { from: [70, 206], to: [26, 328] },
    { from: [26, 328], to: [140, 378] },
    { from: [84, 500], to: [140, 378] },
    { from: [84, 500], to: [176, 562] },
    { from: [26, 328], to: [36, 636], extra: true },
    { from: [36, 636], to: [120, 722] },
    { from: [120, 722], to: [162, 838] },
    { from: [120, 722], to: [56, 908] },
    { from: [116, 36], to: [70, 206], extra: true },
    { from: [36, 636], to: [162, 838], extra: true },
    // Seam: bottom node up to the next tile's top node, with its shifted twin.
    { from: [56, 908], to: [24, 1078], wrap: true },
  ],
};

/**
 * The right gutter's network: sparser, with longer edges and a different
 * rhythm, so the two sides never read as mirror images.
 */
const RIGHT_TILE: NetworkTile = {
  nodes: [
    { x: 170, y: 108, hi: true },
    { x: 80, y: 52 },
    { x: 28, y: 210 },
    { x: 150, y: 296 },
    { x: 92, y: 436, hi: true },
    { x: 176, y: 528 },
    { x: 36, y: 566 },
    { x: 118, y: 694 },
    { x: 168, y: 802 },
    { x: 50, y: 892 },
  ],
  edges: [
    { from: [170, 108], to: [80, 52] },
    { from: [80, 52], to: [28, 210] },
    { from: [80, 52], to: [150, 296], signal: true },
    { from: [28, 210], to: [92, 436] },
    { from: [150, 296], to: [92, 436] },
    { from: [92, 436], to: [176, 528] },
    { from: [36, 566], to: [118, 694] },
    { from: [118, 694], to: [168, 802] },
    { from: [118, 694], to: [50, 892] },
    { from: [170, 108], to: [150, 296], extra: true },
    { from: [28, 210], to: [36, 566], extra: true },
    { from: [176, 528], to: [168, 802], extra: true },
    // Seam: bottom node up to the next tile's top node, with its shifted twin.
    { from: [50, 892], to: [170, 1108], wrap: true },
  ],
};

/** One gutter strip: the tile's edges and nodes, instanced by the pattern. */
function GutterNetwork({ side, tile }: { side: "left" | "right"; tile: NetworkTile }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const patternId = `lp-net-${uid}`;

  // Edges first (with their wrap twins and signals), then nodes on top. The
  // draw-in stagger (`--i`) counts rendered lines so the seam twins animate
  // with their edge rather than as a separate beat.
  const shapes: ReactNode[] = [];
  tile.edges.forEach((edge, index) => {
    const className = edge.extra === true ? "lp-main-edge lp-main-net-extra" : "lp-main-edge";
    const style = { "--i": index } as CSSProperties;
    shapes.push(
      <line
        key={`e${index}`}
        className={className}
        style={style}
        pathLength={1}
        x1={edge.from[0]}
        y1={edge.from[1]}
        x2={edge.to[0]}
        y2={edge.to[1]}
      />,
    );
    if (edge.wrap === true) {
      shapes.push(
        <line
          key={`e${index}-w`}
          className={className}
          style={style}
          pathLength={1}
          x1={edge.from[0]}
          y1={edge.from[1] - TILE_H}
          x2={edge.to[0]}
          y2={edge.to[1] - TILE_H}
        />,
      );
    }
    if (edge.signal === true) {
      shapes.push(
        <line
          key={`e${index}-s`}
          className="lp-signal lp-main-signal"
          x1={edge.from[0]}
          y1={edge.from[1]}
          x2={edge.to[0]}
          y2={edge.to[1]}
        />,
      );
    }
  });
  tile.nodes.forEach((node, index) => {
    if (node.hi === true) {
      shapes.push(
        <circle
          key={`n${index}`}
          className="lp-main-node-hi"
          style={{ "--i": index } as CSSProperties}
          cx={node.x}
          cy={node.y}
          r={3}
        />,
      );
    } else {
      shapes.push(<circle key={`n${index}`} className="lp-main-node" cx={node.x} cy={node.y} r={2.5} />);
    }
  });

  return (
    <div className={`lp-main-net lp-main-net--${side}`} aria-hidden="true">
      <svg
        viewBox={`0 0 ${TILE_W} ${TILE_H}`}
        preserveAspectRatio={side === "right" ? "xMaxYMid meet" : "xMinYMid meet"}
        focusable="false"
      >
        <defs>
          <pattern id={patternId} width={TILE_W} height={TILE_H} patternUnits="userSpaceOnUse">
            {shapes}
          </pattern>
        </defs>
        {/* Fills the whole strip: the pattern tiles it down the page's height.
            The rect is sized in user units well beyond the viewBox rather than
            in percentages, because `meet` centres the viewBox vertically in a
            strip that is much taller than it — a viewBox-sized rect would only
            cover the middle band and leave the top and bottom of the page
            without network. Patterns tile in both directions, so the generous
            bounds are safe at any scale the strip resolves to. */}
        <rect x={-TILE_W} y={-10 * TILE_H} width={3 * TILE_W} height={21 * TILE_H} fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}

/**
 * The full backdrop: glow, dot grid, and the two gutter networks. The layer
 * itself never scrolls or resizes independently of main — it is a painting
 * on main's box, behind everything real.
 */
export function MainBackdrop() {
  return (
    <div className="lp-main-bg" aria-hidden="true">
      <div className="lp-main-glow" />
      <div className="lp-main-dots" />
      <GutterNetwork side="left" tile={LEFT_TILE} />
      <GutterNetwork side="right" tile={RIGHT_TILE} />
    </div>
  );
}

export default MainBackdrop;
