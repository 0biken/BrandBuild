import type { ReactNode } from "react";
import { AlertIcon, CheckIcon } from "./icons";

type AlertProps = {
  tone?: "error" | "success" | "info";
  children: ReactNode;
  className?: string;
};

const tones = {
  error: "bg-danger-soft text-danger-ink border-[#F4C7C3]",
  success: "bg-primary-soft text-primary-ink border-[#BFE3CC]",
  info: "bg-info-soft text-info-ink border-[#C5DDF2]",
} as const;

/**
 * Status message. Errors use role="alert" (assertive); the others use
 * role="status" (polite) so screen readers announce async results.
 */
export function Alert({ tone = "info", children, className = "" }: AlertProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-snug ${tones[tone]} ${className}`}
    >
      <span className="mt-px shrink-0">
        {tone === "success" ? <CheckIcon size={18} /> : <AlertIcon size={18} />}
      </span>
      <span className="[&_a]:font-semibold [&_a]:underline">{children}</span>
    </div>
  );
}
