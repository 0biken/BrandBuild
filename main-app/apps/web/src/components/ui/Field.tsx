import type { ComponentProps, ReactNode } from "react";

export const inputClass =
  "h-12 w-full rounded-xl border border-line-strong bg-surface px-3.5 font-sans text-base text-ink " +
  "transition-[border-color,box-shadow] duration-150 placeholder:text-muted/70 " +
  "focus:border-primary focus:shadow-[0_0_0_3px_rgba(18,161,80,0.18)] focus:outline-none " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-soft";

type FieldProps = Omit<ComponentProps<"input">, "id"> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  trailing?: ReactNode;
  labelAside?: ReactNode;
};

export function Field({
  id,
  label,
  hint,
  error,
  trailing,
  labelAside,
  className = "",
  ...rest
}: FieldProps) {
  const describedBy =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        {labelAside}
      </div>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${inputClass} ${trailing ? "pr-12" : ""} ${className}`}
          {...rest}
        />
        {trailing && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">
            {trailing}
          </div>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
