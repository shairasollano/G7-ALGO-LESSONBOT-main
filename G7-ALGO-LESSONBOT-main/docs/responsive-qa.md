# Responsive QA Report

## Approach

The UI is built mobile-first with a single-column conversation flow, a compact header, and a stable bottom composer. Breakpoints at 640px (tablet) and 1024px (desktop) add breathing room without changing the information architecture. All visualization blocks include textual/table equivalents.

## Verified widths

| Width | Layout | Notes |
|---|---|---|
| 320px | Single column | Composer sticky at bottom; chips wrap; graph viewport scrolls internally; tables scroll horizontally within their container. |
| 375px | Single column | Primary phone width; all controls ≥ 40px tall. |
| 768px | Single column, wider bubbles | Message bubbles capped at 85% width. |
| 1024px | Centered column (max 860px) | Desktop layout; bubbles capped at 75%. |
| 1440px | Centered column | Same as 1024px with more margin. |

## Component behavior by breakpoint

- **Header:** brand + actions on one row; topic/level selectors wrap below on narrow screens.
- **Composer:** textarea + send button remain visible when the on-screen keyboard opens (`100dvh` + `env(safe-area-inset-bottom)`).
- **Graph blocks:** React Flow viewport with pan/zoom (touch + mouse), minimap, and controls; a `<details>` textual alternative and a legend are always present.
- **Trace blocks:** Prev/Next/Reset controls sit directly above the step explanation; the full step list is in a collapsible `<details>`.
- **Quiz blocks:** one question at a time on narrow screens (natural list flow); choices are full-width radio rows ≥ 40px.
- **Tables:** contained horizontal scrolling (`.table-scroll`) — the page itself never scrolls horizontally.
- **Charts:** Recharts `ResponsiveContainer` + a data table equivalent below.

## Accessibility

- Semantic headings (`h1` brand, `h4` step titles), `role="log"` on the thread, `aria-live="polite"` for new messages and step changes.
- All icon-only buttons have `aria-label`/`title`.
- Focus visible on all interactive elements (`:focus-visible` outlines).
- Graph states distinguished by color **and** label/line-style (solid vs dashed edges; legend text).
- Quiz correct/incorrect distinguished by icon (✓/✗) and text, not color alone.
- `prefers-reduced-motion` disables the spinner animation and transitions.
- Touch targets ≥ 40px (chips, choices, buttons); primary actions ≥ 44px.

## Known limitations

- The graph viewport is fixed-height (300–400px) with internal pan/zoom rather than full-page expansion on very small screens; the textual alternative covers the same information.
- KaTeX blocks scroll horizontally on narrow screens for very long formulas.
