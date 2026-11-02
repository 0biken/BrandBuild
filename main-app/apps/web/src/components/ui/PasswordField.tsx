"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Field } from "./Field";
import { EyeIcon, EyeOffIcon } from "./icons";

type PasswordFieldProps = Omit<
  ComponentProps<typeof Field>,
  "type" | "trailing"
> & { children?: ReactNode };

/** Password input with an accessible show/hide toggle (44px target). */
export function PasswordField(props: PasswordFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <Field
      {...props}
      type={show ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="press inline-flex size-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-muted fine:text-ink"
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
    />
  );
}
