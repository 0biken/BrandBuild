import Link from "next/link";
import type { ComponentProps } from "react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "soft" | "ghostOnDark" | "lime" | "dark";
export type ButtonSize = "md" | "lg";

const base =
  "press inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-xl border-0 font-sans font-semibold no-underline " +
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed aria-disabled:pointer-events-none";

// "fine:" is the hover variant gated to fine pointers (see globals.css).
const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary-strong text-white fine:bg-primary-hover disabled:bg-primary-off disabled:text-primary-off-ink aria-disabled:bg-primary-off aria-disabled:text-primary-off-ink",
  outline:
    "border border-line-strong bg-surface text-ink fine:bg-page-hover disabled:text-muted",
  ghost: "bg-transparent text-ink fine:bg-page-hover",
  /** Tinted secondary action inside cards. */
  soft: "bg-page text-ink fine:bg-page-hover",
  /** Ghost button on forest/dark surfaces. */
  ghostOnDark: "bg-transparent text-forest-text fine:bg-forest-2",
  lime: "bg-lime text-forest fine:bg-lime-hover",
  dark: "bg-ink text-white fine:bg-forest",
};

const sizes: Record<ButtonSize, string> = {
  md: "h-11 px-[18px] text-[15px]",
  lg: "h-[52px] px-[22px] text-base",
};

export function buttonStyles({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
} = {}) {
  return [base, variants[variant], sizes[size], block ? "w-full" : "", className]
    .filter(Boolean)
    .join(" ");
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

export function Button({
  variant,
  size,
  block,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, block, className })}
      {...rest}
    />
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

export function ButtonLink({
  variant,
  size,
  block,
  className,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={buttonStyles({ variant, size, block, className })}
      {...rest}
    />
  );
}
