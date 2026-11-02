import type { Metadata } from "next";
import { SplitShell } from "@/components/auth/AuthShell";
import { SignUpForm } from "@/components/auth/SignUpForm";

export const metadata: Metadata = { title: "Create your account" };

const STEPS = [
  "Create your account",
  "Confirm you're a student (optional)",
  "Connect your accounts",
  "Teach it your voice",
];

export default function SignUpPage() {
  return (
    <SplitShell
      aside={
        <div className="flex flex-col gap-7">
          <p className="m-0 max-w-[460px] font-display text-[44px] leading-[1.02] font-bold tracking-[-0.04em] text-white">
            Five minutes from now, your first post is written.
          </p>
          <ol className="m-0 flex max-w-[420px] list-none flex-col gap-3.5 p-0">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={`flex items-center gap-3.5 text-base ${i === 0 ? "" : "text-forest-ink"}`}
              >
                <span
                  className={`inline-flex size-8 items-center justify-center rounded-[10px] font-display font-bold ${
                    i === 0
                      ? "bg-lime text-forest"
                      : "shadow-[inset_0_0_0_1.5px_var(--color-forest-line)]"
                  }`}
                >
                  {i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </div>
      }
    >
      <SignUpForm />
    </SplitShell>
  );
}
