"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { CalendarIcon, ChartIcon, HomeIcon, PlusIcon, UserIcon, type IconProps } from "@/components/ui/icons";
import { ROUTES } from "@/lib/routes";

const TABS: { href: string; label: string; icon: ComponentType<IconProps>; exact?: boolean }[] = [
  { href: ROUTES.home, label: "Home", icon: HomeIcon, exact: true },
  { href: ROUTES.calendar, label: "Calendar", icon: CalendarIcon },
  { href: ROUTES.analytics, label: "Analytics", icon: ChartIcon },
  { href: ROUTES.settings, label: "Account", icon: UserIcon },
];

/**
 * Phone navigation below 860px. No animation when switching tabs
 * (DESIGN.md). The centre button is the primary action.
 */
export function TabBar() {
  const pathname = usePathname();
  const active = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const tab = (t: (typeof TABS)[number]) => {
    const on = active(t.href, t.exact);
    const Icon = t.icon;
    return (
      <Link
        key={t.href}
        href={t.href}
        aria-current={on ? "page" : undefined}
        className={`flex min-h-11 min-w-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold no-underline ${
          on ? "text-primary-hover" : "text-muted"
        }`}
      >
        <Icon size={22} strokeWidth={on ? 2.1 : 1.8} />
        {t.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 hidden h-[72px] items-center justify-around border-t border-line bg-surface-2/95 px-2 pb-2 backdrop-blur-md max-md:flex"
    >
      {tab(TABS[0])}
      {tab(TABS[1])}
      <Link
        href={ROUTES.compose}
        aria-label="New post"
        className="press inline-flex size-[52px] items-center justify-center rounded-2xl bg-primary-strong text-white no-underline"
      >
        <PlusIcon size={24} />
      </Link>
      {tab(TABS[2])}
      {tab(TABS[3])}
    </nav>
  );
}
