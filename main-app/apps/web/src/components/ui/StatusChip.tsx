import type { ComponentType } from "react";
import type { PostState } from "@/lib/api/types";
import {
  AlertIcon,
  CheckIcon,
  ClockIcon,
  PauseIcon,
  RefreshIcon,
  type IconProps,
} from "./icons";

type Tone = { label: string; className: string; Icon: ComponentType<IconProps> };

/**
 * Post state, always icon + text (status is never colour-only).
 * Colours follow DESIGN.md: blue awaiting approval, green published,
 * red failed, amber checking/paused.
 */
export const POST_STATE: Record<PostState, Tone> = {
  scheduled: { label: "Scheduled", className: "bg-primary-soft text-primary-ink", Icon: ClockIcon },
  approval: { label: "Awaiting approval", className: "bg-info-soft text-info-ink", Icon: ClockIcon },
  published: { label: "Published", className: "bg-primary-soft text-primary-ink", Icon: CheckIcon },
  failed: { label: "Failed", className: "bg-danger-soft text-danger-ink", Icon: AlertIcon },
  checking: { label: "Checking", className: "bg-amber-soft text-amber-ink", Icon: RefreshIcon },
  paused: { label: "Paused", className: "bg-amber-soft text-amber-ink", Icon: PauseIcon },
};

export function StatusChip({ state, className = "" }: { state: PostState; className?: string }) {
  const { label, className: tone, Icon } = POST_STATE[state];
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold whitespace-nowrap ${tone} ${className}`}
    >
      <Icon size={14} strokeWidth={2.2} />
      {label}
    </span>
  );
}

const BADGE_TONES = {
  neutral: "bg-page-hover text-ink-2",
  primary: "bg-primary-soft text-primary-ink",
  info: "bg-info-soft text-info-ink",
  amber: "bg-amber-soft text-amber-ink",
  danger: "bg-danger-soft text-danger-ink",
  lime: "bg-lime text-forest",
} as const;

/** Generic small label. Pair a colour tone with meaningful text. */
export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: keyof typeof BADGE_TONES;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold whitespace-nowrap ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
