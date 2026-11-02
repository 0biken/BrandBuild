"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type TabItem<T extends string> = { id: T; label: ReactNode };

/**
 * WAI-ARIA tabs with roving tabindex (arrow keys, Home, End). Controlled:
 * render the active panel yourself with id `${idBase}-panel-${value}` and
 * aria-labelledby `${idBase}-tab-${value}`. Switching has no animation.
 */
export function Tabs<T extends string>({
  idBase,
  label,
  items,
  value,
  onChange,
  className = "",
}: {
  idBase: string;
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent, i: number) {
    const last = items.length - 1;
    const to =
      e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (to === null) return;
    e.preventDefault();
    onChange(items[to].id);
    refs.current[to]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex w-fit gap-1 rounded-xl bg-page-hover p-1 ${className}`}
    >
      {items.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${idBase}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={`${idBase}-panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`min-h-11 cursor-pointer rounded-lg border-0 px-4 text-[15px] font-semibold ${
              on ? "bg-surface text-ink shadow-sm" : "bg-transparent text-ink-2 fine:text-ink"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
