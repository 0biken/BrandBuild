import type { ComponentProps, ReactNode } from "react";

/**
 * On/off switch: a real checkbox with role="switch" (DESIGN.md). The whole
 * row is the label, so the touch target is at least 44px tall.
 */
export function Switch({
  label,
  description,
  className = "",
  ...input
}: Omit<ComponentProps<"input">, "type" | "role"> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center justify-between gap-4 ${className}`}>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{label}</span>
        {description && <span className="text-sm text-muted">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input type="checkbox" role="switch" className="peer sr-only" {...input} />
        <span
          aria-hidden="true"
          className="h-7 w-12 rounded-full bg-line-strong transition-colors duration-150 peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-disabled:opacity-50"
        />
        <span
          aria-hidden="true"
          className="absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-press)] peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}
