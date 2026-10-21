/**
 * Inline SVG icons — the repository has no icon dependency, and adding one
 * purely for decoration is not justified. Every icon here is drawn on the same
 * 24×24 grid with the same stroke weight so navigation, calls to action, the
 * message actions and the animation controls read as one family.
 *
 * This module is the single source of truth: `landing/icons.tsx` re-exports it,
 * so the landing page's existing imports are unchanged and the chat and the
 * landing cannot drift into two different icon vocabularies.
 *
 * Icons are always `aria-hidden` accompaniments to a readable text label, never
 * a replacement for it; the accessible name comes from the label or from the
 * control's own `aria-label`.
 */

export interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false as const,
    className,
  };
}

/** Speech bubble — the chat product itself. */
export function IconChat({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

/** Down arrow — jump to a section below. */
export function IconArrowDown({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 5v14m0 0 6-6m-6 6-6-6" />
    </svg>
  );
}

/** Up arrow — send, or return to the most recent content. */
export function IconArrowUp({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 19V5m0 0-6 6m6-6 6 6" />
    </svg>
  );
}

/** Right arrow — follow a link onward, or advance a step. */
export function IconArrowRight({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 12h14m0 0-6-6m6 6-6 6" />
    </svg>
  );
}

/** Left arrow — go back one step. */
export function IconArrowLeft({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
    </svg>
  );
}

/** Pause bars — halt a running animation or a stream. */
export function IconPause({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)} strokeWidth={2}>
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

/** Play triangle — resume a paused animation. */
export function IconPlay({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="currentColor" stroke="none">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

/** Restart arrow — begin the cycle again (also: regenerate a response). */
export function IconRestart({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}

/** Close mark — dismiss an overlay. */
export function IconClose({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

/** Menu — the navigation drawer affordance. */
export function IconMenu({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

/** Filled square — stop generating. */
export function IconStop({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Plus — start something new. */
export function IconPlus({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Two overlapping sheets — copy the response to the clipboard. */
export function IconCopy({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-7A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
    </svg>
  );
}

/** Ticked box — confirmation that an action succeeded. */
export function IconCheck({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

/** Pencil — rename a conversation. */
export function IconEdit({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L9 18l-4 1 1-4Z" />
    </svg>
  );
}

/** Bin — delete a conversation. */
export function IconTrash({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 7h16" />
      <path d="M10 4h4" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** Bulb — a simpler explanation. */
export function IconLightbulb({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9.5 18h5" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5.9 1.1 1 1.7h5.2c.1-.6.4-1.2 1-1.7A6 6 0 0 0 12 3Z" />
    </svg>
  );
}

/** Framed statement — a formal proof. */
export function IconProof({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M5 4h11l3 3v13H5Z" />
      <path d="M8.5 12.5h7" />
      <path d="M8.5 15.5h4" />
      <path d="M8.5 9.5h3" />
    </svg>
  );
}

/** Stacked sheets — another worked example. */
export function IconLayers({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3 3 7.5 12 12l9-4.5Z" />
      <path d="m3 12.5 9 4.5 9-4.5" />
      <path d="m3 17 9 4.5L21 17" />
    </svg>
  );
}

/** Two opposing arrows — a comparison. */
export function IconCompare({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 8h11m0 0-3-3m3 3-3 3" />
      <path d="M20 16H9m0 0 3-3m-3 3 3 3" />
    </svg>
  );
}

/** Checklist — a practice quiz. */
export function IconQuiz({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 6.5 5.8 8.3 9 5" />
      <path d="M4 16.5 5.8 18.3 9 15" />
      <path d="M12.5 6.5H20M12.5 16.5H20" />
      <path d="M12.5 11.5H20" />
    </svg>
  );
}

/** Arrow returning to a baseline — scroll back to the newest content. */
export function IconArrowDownToLine({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 4v9m0 0 4-4m-4 4-4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

/** Small node graph — the product's own subject matter, used as a mark. */
export function IconGraph({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="6" cy="7" r="2.4" />
      <circle cx="18" cy="9" r="2.4" />
      <circle cx="11" cy="18" r="2.4" />
      <path d="M8.1 8.3 15.7 16M8.4 6.7l7.2 1.6M16.9 11.2 12.6 15.7" />
    </svg>
  );
}

/** Shield — where conversation data is kept. */
export function IconShield({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3 5 5.8v5.4c0 4.3 2.9 7.6 7 9.3 4.1-1.7 7-5 7-9.3V5.8Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  );
}

/** Clock with a hand — conversation history. */
export function IconHistory({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}
