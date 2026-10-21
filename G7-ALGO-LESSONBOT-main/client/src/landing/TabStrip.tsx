/**
 * Shared accessible tab strip used by the hero scene player and the
 * interactive demo. One implementation, so both get the same keyboard
 * behaviour: roving tabindex, Arrow keys, Home and End.
 */
import { useCallback, useRef, type KeyboardEvent } from "react";

export interface TabDef {
  id: string;
  label: string;
}

export function tabIds(baseId: string, id: string) {
  return { tab: `${baseId}-tab-${id}`, panel: `${baseId}-panel-${id}` };
}

interface TabStripProps {
  tabs: TabDef[];
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Stable id prefix; pair with tabIds() on the panel. */
  baseId: string;
  ariaLabel: string;
}

export function TabStrip({ tabs, activeIndex, onSelect, baseId, ariaLabel }: TabStripProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const last = tabs.length - 1;
      let next = activeIndex;
      if (event.key === "ArrowLeft") next = activeIndex === 0 ? last : activeIndex - 1;
      if (event.key === "ArrowRight") next = activeIndex === last ? 0 : activeIndex + 1;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = last;
      onSelect(next);
      refs.current[next]?.focus();
    },
    [activeIndex, onSelect, tabs.length],
  );

  return (
    <div className="lp-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="tab"
          id={tabIds(baseId, tab.id).tab}
          aria-selected={index === activeIndex}
          aria-controls={tabIds(baseId, tab.id).panel}
          tabIndex={index === activeIndex ? 0 : -1}
          className={`lp-tab ${index === activeIndex ? "lp-tab-active" : ""}`}
          onClick={() => onSelect(index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
