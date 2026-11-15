"use client";

import Link from "next/link";
import { BellIcon } from "@/components/ui/icons";
import { listAccounts, listPlatforms } from "@/lib/api/accounts";
import { getHomeStats } from "@/lib/api/analytics";
import { getBrand } from "@/lib/api/brand";
import { invalidate, useQuery } from "@/lib/api/hooks";
import { listNotifications } from "@/lib/api/notifications";
import { listPosts } from "@/lib/api/posts";
import { ROUTES } from "@/lib/routes";
import { greeting, useNow } from "@/lib/useNow";
import { FinishSetup, LoadError, NeedsAttention, StartPost, Stats, TodaysIdea, UpNext } from "./HomeSections";
import { getOnboarding, nextStepPath } from "@/lib/api/onboarding";

export function HomeScreen() {
  const now = useNow();
  const brand = useQuery("brand", getBrand);
  const posts = useQuery("posts", listPosts);
  const stats = useQuery("stats", getHomeStats);
  const accounts = useQuery("accounts", listAccounts);
  const platforms = useQuery("platforms", listPlatforms);
  const onboarding = useQuery("onboarding", getOnboarding);
  const notes = useQuery("notifications", listNotifications);
  const unread = notes.data?.filter((n) => !n.read).length ?? 0;
  const setupNext = onboarding.data ? nextStepPath(onboarding.data) : null;
  const setupLeft = onboarding.data ? Object.values(onboarding.data).filter((s) => s === "todo").length : 0;

  const failed = posts.error || stats.error || accounts.error;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-7">
      <header className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] text-muted">
            {now
              ? now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
              : " "}
          </span>
          <h1 className="m-0 font-display text-[34px] leading-tight font-bold tracking-[-0.03em] max-md:text-[28px]">
            {now ? greeting(now) : "Welcome back"}
            {brand.data ? `, ${brand.data.name}` : ""}
          </h1>
        </div>
        <Link
          href={ROUTES.notifications}
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          className="press relative inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink no-underline fine:bg-page-hover"
        >
          <BellIcon size={20} />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-2 right-2 size-2.5 rounded-full bg-primary shadow-[0_0_0_2px_var(--color-surface-2)]"
            />
          )}
        </Link>
      </header>

      {setupNext && <FinishSetup remaining={setupLeft} href={setupNext} />}

      <StartPost brand={brand.data} />

      {failed ? (
        <LoadError
          onRetry={() => {
            ["posts", "stats", "accounts"].forEach(invalidate);
          }}
        />
      ) : (
        <>
          <Stats stats={stats.data} accountCount={accounts.data?.length} />
          <div className="flex flex-wrap items-start gap-5">
            <UpNext posts={posts.data} platforms={platforms.data} />
            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
              <TodaysIdea />
              <NeedsAttention accounts={accounts.data} posts={posts.data} platforms={platforms.data} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
