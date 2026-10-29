"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

/**
 * Action menu (WAI-ARIA menu button): Enter/Space/ArrowDown opens, arrows
 * move, Esc or Tab closes, focus returns to the trigger.
 */
export function Menu({
  label,
  trigger,
  items,
  align = "end",
}: {
  /** Accessible name for the trigger, e.g. "More actions for this post". */
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current.find((el) => el && !el.disabled)?.focus();
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function close(refocus = true) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  function onMenuKey(e: KeyboardEvent) {
    const els = itemRefs.current.filter((el): el is HTMLButtonElement => !!el && !el.disabled);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = els.length;
      els[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      els[e.key === "Home" ? 0 : els.length - 1]?.focus();
    }
  }

  return (
    <div ref={root} className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="press inline-flex size-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-ink-2 fine:bg-page-hover"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={`rise absolute top-full z-50 mt-1.5 flex min-w-52 flex-col rounded-2xl border border-line bg-surface p-1.5 shadow-[0_20px_40px_-20px_rgba(15,26,19,0.35)] ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={`flex min-h-11 cursor-pointer items-center rounded-xl border-0 bg-transparent px-3 text-left text-[15px] font-medium focus:outline-none focus-visible:bg-page-hover disabled:cursor-not-allowed disabled:opacity-50 fine:bg-page-hover ${
                item.danger ? "text-danger-ink" : "text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
