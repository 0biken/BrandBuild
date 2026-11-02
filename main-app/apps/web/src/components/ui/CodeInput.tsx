"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

const LENGTH = 6;

type CodeInputProps = {
  value: string;
  onChange: (next: string) => void;
  /** Called once all digits are present (typing or paste). */
  onComplete?: (code: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
};

/**
 * Six single-digit boxes. Typing advances, Backspace steps back, arrow keys
 * move, and pasting a full code into any box fills and submits it.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  invalid,
  disabled,
  autoFocus,
  describedBy,
}: CodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? "");

  function commit(next: string, focusIndex: number) {
    const clean = next.replace(/\D/g, "").slice(0, LENGTH);
    onChange(clean);
    refs.current[Math.min(focusIndex, LENGTH - 1)]?.focus();
    if (clean.length === LENGTH) onComplete?.(clean);
  }

  function onInput(i: number, raw: string) {
    const typed = raw.replace(/\D/g, "");
    if (!typed) {
      commit(value.slice(0, i) + value.slice(i + 1), i);
      return;
    }
    const next = (value.slice(0, i) + typed + value.slice(i + 1)).slice(0, LENGTH);
    commit(next, i + typed.length);
  }

  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      commit(value.slice(0, i - 1) + value.slice(i), i - 1);
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < LENGTH - 1) {
      e.preventDefault();
      refs.current[i + 1]?.focus();
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    e.preventDefault();
    commit(pasted, pasted.length);
  }

  return (
    <div
      role="group"
      aria-label="6-digit code"
      aria-describedby={describedBy}
      className="flex gap-2 max-md:gap-1.5"
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={LENGTH}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid ? true : undefined}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          className={
            "h-14 w-12 rounded-xl border bg-surface text-center font-display text-2xl font-semibold text-ink " +
            "focus:border-2 focus:border-primary focus:shadow-[0_0_0_3px_rgba(18,161,80,0.18)] focus:outline-none " +
            "disabled:opacity-60 max-md:h-[54px] max-md:w-11 " +
            (invalid
              ? "border-[1.5px] border-danger bg-danger-soft"
              : d
                ? "border-[1.5px] border-ink"
                : "border-line-strong")
          }
        />
      ))}
    </div>
  );
}
