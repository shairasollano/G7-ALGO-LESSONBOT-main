# G7 Algo — Landing Page Repair & Polish: Final Report

Scope: the landing page (`client/src/landing/`), its shared solver fixtures
(`shared/landing-scenes.ts`), and the React Flow graph block
(`client/src/components/blocks/GraphBlock.tsx`). No AI provider, `.env`, API
key, backend solver, or algorithm-correctness code was modified. Nothing was
committed.

---

## 1. Root cause of the hero / scene sizing coupling

The hero resized whenever the scene changed because the scene panel was
*content-sized*, not *bounded*. Three things inside it had unbounded height:

1. **The graph SVG had `height: auto`.** Its rendered height followed the
   fixture's aspect ratio, which differs per scene (single graph vs. the
   dual reduction scene vs. the Cook–Levin tableau).
2. **Step tables accumulated.** The progressive table grows a row per solver
   step, so step 4 was taller than step 1.
3. **Meta / annotation / caption text** wrapped to a different number of lines
   per scene.

Because the grid row height is driven by its tallest child, every one of these
flowed straight into the hero's height. A Playwright baseline sampled the hero
height across scene and step changes and found it oscillating at every
viewport (e.g. 1440px: 712 → 914 → 860 → 712px; 320px: 1577 → 1871px).

## 2. How the fix addresses it (dimensions)

Structural, not a single hardcoded height:

- `.lp-scene` is a **flex column with a fixed height per breakpoint**, driven
  by two custom properties:
  | breakpoint | `--lp-scene-h` | `--lp-scene-canvas-h` |
  |---|---|---|
  | base (mobile) | 720px | 240px |
  | ≥640px | 700px | 300px |
  | ≥1024px | 760px | 320px |
  | ≥1280px | 780px | 340px |
- The canvas box (`.lp-scene-visual`) is a **fixed-height, `min-width: 0`
  grid track**; the SVG fills it with `preserveAspectRatio="xMidYMid meet"`,
  so a differently-proportioned graph scales inside the box instead of
  stretching the layout.
- Everything that legitimately varies in length — caption, legend, text
  descriptions, step text, step table — moved into a single
  **`.lp-scene-scroll` region** (`flex: 1 1 auto; min-height: 0;
  overflow-y: auto`). It absorbs its own growth.
- The head (title) and controls are pinned (`flex: none`), bracketing the
  scroll region.

Result: the hero height is now a constant per viewport. Verified
`heroStable: true` at 320/360/390/768/1024/1440px with no ticker overflow, no
clipping, and no horizontal overflow at any width.

## 3. Animation behaviour

A new `HeroExample.tsx` drives both halves of the hero's example from the real
vertex-cover fixture (the curated path graph A–B–C–D), so the background graph
and the ticker table always describe the same solver step:

- **`HeroBackdrop`** — an absolutely positioned SVG layer
  (`pointer-events: none`, `aria-hidden`, out of flow, so it can never affect
  sizing or intercept clicks). Edges draw progressively via `pathLength="1"`
  plus a CSS dashoffset animation; nodes illuminate in sequence via
  staggered `transition-delay`; a travelling signal runs the dash technique
  along the edge the solver is currently picking.
- **`HeroTicker`** — the legible half: a compact table that fills one row per
  progress step (`∅/3 → {A,B}/1 → {A,B,C,D}/0`) with a Play/Pause + Restart
  control. Row keys are stable so only genuinely new cells animate.

Preferences honoured:
- `prefers-reduced-motion` freezes on the completed step, renders all rows,
  and hides the Pause control (verified: `tickerControlsHidden: true`,
  3 rows, scene panel reads "STEP 4 OF 4 · MOTION REDUCED").
- No per-frame React state — the whole loop is one `setTimeout` chain (a few
  updates per second). Pausing sets `data-paused`, which also freezes the CSS
  animation half in step with the timer.

## 4. Visual changes (shadows / depth / icons)

Added layered-shadow design tokens to `landing.css` and applied depth to the
hero panel, the ticker card, topic cards, the demo frame, and buttons (subtle
contact + ambient layers, restrained accent glow on active graph elements).
Added a small `icons.tsx` inline-SVG set (pause, play, restart, check,
chevrons) used by the ticker controls and section markers — no icon
dependency added.

## 5. Restored content

Recovered the hero's example-in-motion, which had no prior implementation in
Git (the landing directory was untracked; the `dashdraw` keyframes in `dist`
were React Flow's own). No prior animation existed to restore, so the backdrop
and ticker were implemented fresh against the real fixture, per the brief's
allowance. Existing landing copy, chat app, routes, topic catalog, and
navigation were preserved — nothing was deleted to fix layout.

## 6. React Flow fixes

`GraphBlock.tsx` root cause: React Flow's built-in node type draws handles on
top/bottom and forces a fixed width, which **overlapped nodes spaced 140–150px
apart and routed edges diagonally through node bodies**.

Fix: a custom `algo` node type that
- hugs its label instead of imposing a width,
- exposes one target + one source handle on **all four sides**
  (`s-left` / `t-right` etc.), and
- lets each edge pick the handle pair nearest its endpoints (dx/dy based).

Verified in the rendered browser: 4 nodes, **0 overlaps**, 3 edges anchored on
correct sides. The chat app shares this component and is unaffected
(its `Handle` stub in tests was extended, purely additive).

## 7. Screenshots / rendered verification

Captured at 320, 360, 390, 768, 1024, 1440px plus full-page, reduced-motion,
mobile-nav-open, and demo-section passes (`/tmp/opencode/shots/final-*.png`).
Confirmed by eye: right-margin A–B–C–D chain clear of all copy on desktop;
backdrop correctly hidden on the stacked mobile layout; bounded ticker;
scrollable step region.

## 8. Test results

| suite | result |
|---|---|
| Client typecheck | **pass** (0 errors) |
| Server typecheck | **pass** (0 errors) |
| Client tests | **97 passed / 97** across 11 files |
| Server `landing-scenes` | **27 passed / 27** (fixtures the hero draws from) |
| Production build | **succeeds** (chunk-size note is pre-existing) |
| Console errors (Playwright) | **0** at all six viewports |

The client suite emits 18 `act(...)` warnings spanning `App.tsx` and Landing's
async catalog `load()`. This is a pre-existing pattern in the suite (they fire
on the chat app too); an `armed`-after-mount experiment in the hero timer did
not change the count, confirming the ticker is not the trigger, so the
experiment was reverted.

## 9. Files changed (this session)

- `client/src/landing/` — **new**: `Landing.tsx`, `AlgoScene.tsx`,
  `HeroExample.tsx`, `landing.css`, `icons.tsx`, `SceneThumb.tsx`,
  `TabStrip.tsx`, `use-motion.ts`, `landing-copy.ts`, plus tests.
- `shared/landing-scenes.ts` — **new**, solver-verified fixtures.
- `client/src/components/blocks/GraphBlock.tsx` — custom `algo` node type
  (+162/−40 lines vs. tracked).
- `client/src/styles.css` — `.g7-handle` rule only (+39 lines).
- `client/src/landing/Landing.test.tsx` — `Handle` stub added (additive).

Chat components, backend solvers, providers, and tests appear in `git status`
as **pre-existing working-tree state**; I did not edit them this session.

## 10. Remaining problems

- **Ticker bay reserves full height before filling.** The fixed 156px bay is
  empty below row 1 at step 1. This is the deliberate cost of a fixed bay —
  the alternative (content-sized) is what caused the original hero
  oscillation. Reduced-motion confirms all three rows fill it.
- **Reduced-motion resting state shows mismatched step numbers.** The ticker
  animates only the three *progress* steps, so it stops on step 3, while the
  scene panel advances to its final step 4 ("Complexity..."). At rest under
  `prefers-reduced-motion` the two halves therefore read different step
  numbers, and the ticker caption is left on its step-3 text. The data is
  correct (all three rows render: ∅/3 → {A,B}/1 → {A,B,C,D}/0); the defect is
  the stale caption and the panel/ticker step desync in that one state. Not
  fixed here — flagged for a follow-up that syncs the ticker's resting caption
  to the panel's final step.
- **`act(...)` warnings** in the client suite are pre-existing and out of
  scope for this landing-page work.
- **Bundle chunk >500 kB** warning at build is pre-existing and unrelated.
- Nothing was committed, per instruction.
