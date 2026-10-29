"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./icons";

/**
 * Modal built on native <dialog>.showModal(): the browser makes the rest of
 * the page inert, traps focus, handles Esc and restores focus on close.
 * `variant="sheet"` slides up from the bottom (phone pattern).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  variant = "modal",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  variant?: "modal" | "sheet";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const sheet = variant === "sheet";

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClose={onClose}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === e.currentTarget) onClose();
      }}
      className={`max-h-[90vh] w-full overflow-auto border-0 bg-surface p-0 text-ink shadow-[0_40px_80px_-30px_rgba(15,26,19,0.45)] backdrop:bg-ink/40 ${
        sheet
          ? "bb-sheet mx-0 mt-auto mb-0 max-w-none rounded-t-[28px]"
          : "bb-dialog m-auto max-w-[min(480px,calc(100vw-32px))] rounded-[28px]"
      }`}
    >
      <div className="flex flex-col gap-5 p-7 max-md:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 id={`${id}-title`} className="m-0 font-display text-2xl font-bold tracking-[-0.02em]">
              {title}
            </h2>
            {description && (
              <div id={`${id}-desc`} className="text-[15px] text-ink-2">
                {description}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-muted fine:bg-page-hover"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        {children}
        {footer && <div className="flex flex-wrap justify-end gap-3 pt-1">{footer}</div>}
      </div>
    </dialog>
  );
}
