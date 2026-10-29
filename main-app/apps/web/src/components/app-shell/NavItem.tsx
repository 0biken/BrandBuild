"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import type { IconProps } from "@/components/ui/icons";

interface NavItemProps {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
  /** Match the path exactly (for the app root, which prefixes every route). */
  exact?: boolean;
  badge?: number | string;
  /** Screen-reader text for the badge, e.g. "3 awaiting approval". */
  badgeLabel?: string;
  badgeVariant?: "primary" | "neutral";
}

export function NavItem({
  href,
  label,
  icon: Icon,
  exact = false,
  badge,
  badgeLabel,
  badgeVariant = "primary",
}: NavItemProps) {
  const pathname = usePathname();
  const isActive = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`press flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors no-underline ${
        isActive
          ? "bg-primary-soft font-semibold text-primary-ink"
          : "font-medium text-ink-2 fine:bg-page-hover"
      }`}
    >
      <Icon
        size={20}
        strokeWidth={isActive ? 2.1 : 1.8}
        className={isActive ? "text-primary-ink" : "text-ink-2"}
      />
      <span>{label}</span>
      {badge !== undefined && (
        <span
          className={`ml-auto flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none ${
            badgeVariant === "primary"
              ? "bg-primary-strong text-white"
              : "bg-line-strong text-ink-2"
          }`}
        >
          <span aria-hidden={badgeLabel ? true : undefined}>{badge}</span>
          {badgeLabel && <span className="sr-only">, {badgeLabel}</span>}
        </span>
      )}
    </Link>
  );
}
