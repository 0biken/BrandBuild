"use client";

import { useId, useState } from "react";
import { CloseIcon } from "./icons";

/**
 * A list of short words or phrases, typed one at a time. Enter or comma adds,
 * Backspace on an empty input removes the last one.
 */
export function ChipInput({
  label,
  hint,
  values,
  onChange,
  tone = "primary",
  placeholder = "Add…",
}: {
  label: string;
  hint?: string;
  values: string[];
  onChange: (next: string[]) => void;
  tone?: "primary" | "neutral";
  placeholder?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const chip = tone === "primary" ? "bg-primary-soft text-primary-ink" : "bg-page text-ink-2";

  function add(raw: string) {
    const v = raw.trim().replace(/,$/, "").trim();
    if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-xl border border-line-strong bg-surface p-1.5 focus-within:border-primary focus-within:shadow-[0_0_0_3px_rgba(18,161,80,0.18)]">
        <ul aria-label={label} className="m-0 contents list-none p-0">
          {values.map((v) => (
            <li key={v} className={`inline-flex h-8 items-center gap-0.5 rounded-lg pr-0.5 pl-2.5 text-sm font-semibold ${chip}`}>
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-current fine:bg-white/60"
              >
                <CloseIcon size={11} />
              </button>
            </li>
          ))}
        </ul>
        <input
          id={id}
          value={draft}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="h-8 min-w-24 flex-1 border-0 bg-transparent px-1.5 text-[15px] text-ink outline-none placeholder:text-muted/70"
        />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
