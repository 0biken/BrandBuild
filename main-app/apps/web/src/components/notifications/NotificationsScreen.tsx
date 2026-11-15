"use client";

import Link from "next/link";
import { useState, type ComponentType } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import {
  AlertIcon,
  ApprovalsIcon,
  BellIcon,
  ChartIcon,
  CheckIcon,
  RefreshIcon,
  type IconProps,
} from "@/components/ui/icons";
import { invalidate, useQuery } from "@/lib/api/hooks";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/api/notifications";
import type { AppNotification, NotificationKind } from "@/lib/api/types";
import { timeAgo } from "@/lib/postDates";
import { useNow } from "@/lib/useNow";

type Filter = "all" | "unread";

/** Icon + tone per kind; colours follow the post states in DESIGN.md. */
const KIND: Record<NotificationKind, { Icon: ComponentType<IconProps>; className: string }> = {
  approval: { Icon: ApprovalsIcon, className: "bg-info-soft text-info-ink" },
  failed: { Icon: AlertIcon, className: "bg-danger-soft text-danger-ink" },
  reconnect: { Icon: RefreshIcon, className: "bg-amber-soft text-amber-ink" },
  published: { Icon: CheckIcon, className: "bg-primary-soft text-primary-ink" },
  insights: { Icon: ChartIcon, className: "bg-primary-soft text-primary-ink" },
};

export function NotificationsScreen() {
  const now = useNow();
  const toast = useToast();
  const notes = useQuery("notifications", listNotifications);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);

  const all = notes.data ?? [];
  const unread = all.filter((n) => !n.read).length;
  const shown = filter === "unread" ? all.filter((n) => !n.read) : all;

  async function readAll() {
    setBusy(true);
    const res = await markAllNotificationsRead();
    setBusy(false);
    if (!res.ok) toast({ tone: "error", message: "We couldn't mark those as read. Try again." });
    invalidate("notifications");
  }

  // Fire and forget: the link navigates either way.
  function open(n: AppNotification) {
    if (n.read) return;
    markNotificationRead(n.id).then(() => invalidate("notifications"));
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[34px] leading-tight font-bold tracking-[-0.03em] max-md:text-[28px]">
            Notifications
          </h1>
          <p className="m-0 text-[15px] text-muted" aria-live="polite">
            {notes.data ? (unread ? `${unread} unread` : "You're all caught up") : " "}
          </p>
        </div>
        <Button variant="outline" onClick={readAll} disabled={busy || unread === 0}>
          Mark all as read
        </Button>
      </header>

      <Tabs
        idBase="notes"
        label="Show"
        items={[
          { id: "all", label: "All" },
          { id: "unread", label: unread ? `Unread (${unread})` : "Unread" },
        ]}
        value={filter}
        onChange={setFilter}
      />

      <div role="tabpanel" id={`notes-panel-${filter}`} aria-labelledby={`notes-tab-${filter}`}>
        {notes.error ? (
          <EmptyState
            tone="error"
            icon={AlertIcon}
            title="We couldn't load your notifications"
            action={<Button variant="outline" onClick={notes.refetch}>Try again</Button>}
          />
        ) : !notes.data ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={BellIcon}
            title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
            body="We'll let you know when a post needs approval, goes live or runs into a problem."
            action={
              filter === "unread" && all.length > 0 ? (
                <Button variant="outline" onClick={() => setFilter("all")}>Show all</Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {shown.map((n) => {
              const { Icon, className } = KIND[n.kind];
              return (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => open(n)}
                    className={`press flex items-start gap-3 rounded-2xl border p-4 text-ink no-underline fine:bg-page-hover ${
                      n.read ? "border-line bg-surface" : "border-primary/30 bg-[#F2FAF5]"
                    }`}
                  >
                    <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${className}`}>
                      <Icon size={20} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={`text-[15px] ${n.read ? "font-medium" : "font-semibold"}`}>
                        {!n.read && <span className="sr-only">Unread: </span>}
                        {n.title}
                      </span>
                      <span className="text-sm text-ink-2">{n.body}</span>
                      <time dateTime={n.at} className="text-[13px] text-muted">
                        {now ? timeAgo(n.at, now) : " "}
                      </time>
                    </span>
                    {!n.read && <span aria-hidden="true" className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
