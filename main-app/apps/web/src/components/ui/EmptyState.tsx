import type { ComponentType, ReactNode } from "react";
import type { IconProps } from "./icons";

/** Empty or error state for a list or page section. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  tone = "neutral",
}: {
  icon?: ComponentType<IconProps>;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className="flex flex-col items-center gap-3 rounded-[24px] border border-dashed border-line-strong bg-surface-2 px-6 py-12 text-center"
    >
      {Icon && (
        <span
          className={`inline-flex size-12 items-center justify-center rounded-2xl ${
            tone === "error" ? "bg-danger-soft text-danger-ink" : "bg-primary-soft text-primary-ink"
          }`}
        >
          <Icon size={24} />
        </span>
      )}
      <h3 className="m-0 font-display text-xl font-bold tracking-[-0.02em]">{title}</h3>
      {body && <p className="m-0 max-w-sm text-[15px] text-ink-2">{body}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
