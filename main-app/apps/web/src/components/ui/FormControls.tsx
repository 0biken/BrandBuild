import type { ComponentProps, ReactNode } from "react";

const control =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 font-sans text-base text-ink " +
  "transition-[border-color,box-shadow] duration-150 placeholder:text-muted/70 " +
  "focus:border-primary focus:shadow-[0_0_0_3px_rgba(18,161,80,0.18)] focus:outline-none " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-soft disabled:opacity-60";

function Labelled({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="m-0 text-sm font-medium text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: ReactNode, error?: string) =>
  [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

type Common = { id: string; label: string; hint?: ReactNode; error?: string };

/** Native select: best keyboard and mobile behaviour for free. */
export function Select({
  id,
  label,
  hint,
  error,
  className = "",
  children,
  ...rest
}: Common & Omit<ComponentProps<"select">, "id">) {
  return (
    <Labelled id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} h-12 cursor-pointer appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='20'%20height='20'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%235B655D'%20stroke-width='2'%3E%3Cpath%20d='M6%209l6%206%206-6'/%3E%3C/svg%3E")] bg-[position:right_12px_center] bg-no-repeat pr-10 ${className}`}
        {...rest}
      >
        {children}
      </select>
    </Labelled>
  );
}

/** Multi-line text with an optional live character count. */
export function Textarea({
  id,
  label,
  hint,
  error,
  limit,
  className = "",
  value,
  ...rest
}: Common & Omit<ComponentProps<"textarea">, "id"> & { limit?: number }) {
  const length = typeof value === "string" ? value.length : undefined;
  const over = limit !== undefined && length !== undefined && length > limit;
  return (
    <Labelled id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        value={value}
        aria-invalid={error || over ? true : undefined}
        aria-describedby={[describedBy(id, hint, error), limit ? `${id}-count` : ""].filter(Boolean).join(" ") || undefined}
        className={`${control} min-h-28 resize-y py-3 leading-relaxed ${className}`}
        {...rest}
      />
      {limit !== undefined && length !== undefined && (
        <p
          id={`${id}-count`}
          aria-live="polite"
          className={`m-0 text-right font-mono text-xs ${over ? "font-semibold text-danger-ink" : "text-muted"}`}
        >
          {length.toLocaleString()} / {limit.toLocaleString()}
          {over && " (too long)"}
        </p>
      )}
    </Labelled>
  );
}
