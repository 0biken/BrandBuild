"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusChip } from "@/components/ui/StatusChip";
import { AlertIcon, ArrowRightIcon, CalendarIcon, SparkIcon, WarningTriangleIcon } from "@/components/ui/icons";
import type {
  Brand,
  ConnectedAccount,
  PlatformConfig,
  PostItem,
  StatItem,
} from "@/lib/api/types";
import { dayAndDate, postTimestamp } from "@/lib/postDates";
import { ROUTES } from "@/lib/routes";

const card = "rounded-[20px] border border-line bg-surface";
const h2 = "m-0 font-display text-[22px] font-bold tracking-[-0.02em]";

const composeHref = (idea: string) =>
  idea.trim() ? `${ROUTES.compose}?idea=${encodeURIComponent(idea.trim())}` : ROUTES.compose;

// ---------- Start a post ----------

const SUGGESTIONS = ["Product drop teaser", "Customer shout-out"];

export function StartPost({ brand }: { brand?: Brand }) {
  const router = useRouter();
  const [idea, setIdea] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    router.push(composeHref(idea));
  }

  return (
    <section aria-label="Start a post" className={`${card} flex flex-col gap-3.5 p-[22px] max-md:p-4`}>
      {/* action + name: submits to the composer even before hydration. */}
      <form action={ROUTES.compose} onSubmit={submit} className="flex flex-col gap-3.5">
        <label htmlFor="prompt" className="flex items-center gap-2 text-[15px] font-semibold">
          <SparkIcon size={18} className="text-primary" />
          What do you want to post about?
        </label>
        <div className="flex flex-wrap gap-3">
          <input
            id="prompt"
            name="idea"
            type="text"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder="A behind-the-scenes look at how we pack weekend orders"
            className="h-[52px] min-w-0 flex-[1_1_360px] rounded-[14px] border border-line-strong bg-surface-2 px-4 text-base text-ink placeholder:text-muted/70 focus:border-primary focus:shadow-[0_0_0_3px_rgba(18,161,80,0.18)] focus:outline-none"
          />
          <Button type="submit" size="lg" className="rounded-[14px] max-md:w-full">
            Generate post
          </Button>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>Writing as</span>
        <Link
          href={ROUTES.brand}
          className="inline-flex min-h-[30px] items-center rounded-lg bg-primary-soft px-2.5 font-semibold text-primary-ink no-underline"
        >
          {brand ? `${brand.name} · ${brand.voice}` : "your brand"}
        </Link>
        <span className="max-md:hidden">· Try</span>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setIdea(s)}
            className="press min-h-[30px] cursor-pointer rounded-lg border-0 bg-transparent px-2.5 text-sm text-ink fine:bg-page-hover max-md:hidden"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- Last 7 days ----------

export function Stats({ stats, accountCount }: { stats?: StatItem[]; accountCount?: number }) {
  return (
    <section aria-labelledby="stats-h" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="stats-h" className={h2}>Last 7 days</h2>
        {accountCount !== undefined && (
          <span className="text-sm text-muted">
            across {accountCount} account{accountCount === 1 ? "" : "s"}
          </span>
        )}
        <Link href={ROUTES.analytics} className="ml-auto text-sm font-semibold">
          Analytics
        </Link>
      </div>
      <ul className="m-0 grid list-none grid-cols-4 gap-3 p-0 max-md:grid-cols-2">
        {stats
          ? stats.map((s) => (
              <li key={s.label} className={`${card} flex flex-col gap-2 p-[18px] max-md:p-3.5`}>
                <span className="text-xs font-semibold text-muted">{s.label}</span>
                <span className="font-display text-[38px] leading-none font-bold tracking-[-0.03em] max-md:text-[30px]">
                  {s.value}
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="flex items-center gap-1 text-sm font-semibold"
                    style={{ color: s.deltaColor }}
                  >
                    <ArrowRightIcon size={14} strokeWidth={2.4} className={s.isUp ? "-rotate-45" : "rotate-45"} />
                    <span className="sr-only">{s.isUp ? "Up" : "Down"}</span>
                    {s.delta}
                  </span>
                  <svg width="72" height="24" viewBox="0 0 72 24" aria-hidden="true" className="shrink-0">
                    <polyline
                      points={s.spark}
                      fill="none"
                      stroke={s.sparkColor}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </li>
            ))
          : Array.from({ length: 4 }, (_, i) => (
              <li key={i}>
                <Skeleton className="h-[118px] rounded-[18px]" />
              </li>
            ))}
      </ul>
    </section>
  );
}

// ---------- Up next ----------

export function UpNext({ posts, platforms }: { posts?: PostItem[]; platforms?: PlatformConfig[] }) {
  const upcoming = posts
    ?.filter((p) => p.state === "scheduled" || p.state === "approval" || p.state === "paused")
    .sort((a, b) => postTimestamp(a) - postTimestamp(b))
    .slice(0, 5);
  const byId = new Map(platforms?.map((p) => [p.id, p]));
  const scheduledCount = posts?.filter((p) => p.state === "scheduled").length ?? 0;

  return (
    <section aria-labelledby="upnext-h" className={`${card} flex min-w-0 flex-[999_1_440px] flex-col py-2`}>
      <div className="flex flex-wrap items-baseline gap-3 px-5 pt-3.5 pb-2.5">
        <h2 id="upnext-h" className={h2}>Up next</h2>
        {posts && <span className="text-sm text-muted">{scheduledCount} scheduled</span>}
        <Link href={ROUTES.calendar} className="ml-auto text-sm font-semibold">
          Open calendar
        </Link>
      </div>
      {!upcoming ? (
        <div className="flex flex-col gap-2 px-5 pb-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[60px]" />
          ))}
        </div>
      ) : upcoming.length === 0 ? (
        <div className="px-5 pb-4">
          <EmptyState
            icon={CalendarIcon}
            title="Nothing scheduled yet"
            body="Write a post and pick a time. It shows up here."
            action={<ButtonLink href={ROUTES.compose}>New post</ButtonLink>}
          />
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {upcoming.map((p) => {
            const { day, date } = dayAndDate(p.dateStr);
            return (
              <li key={p.id}>
                <Link
                  href={ROUTES.post(p.id)}
                  className="flex items-center gap-3.5 px-5 py-3 text-ink no-underline transition-colors duration-150 fine:bg-surface-2 max-md:flex-wrap"
                >
                  <span className="flex size-[52px] shrink-0 flex-col items-center justify-center rounded-xl bg-page">
                    <span className="text-[11px] font-semibold text-muted">{day}</span>
                    <span className="font-display text-xl leading-none font-bold">{date}</span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[15px] font-semibold">{p.title}</span>
                    <span className="flex items-center gap-1.5 text-sm text-muted">
                      <span className="font-mono text-[13px]">{p.time}</span>
                      <span aria-hidden="true">·</span>
                      {p.platforms.map((id) => {
                        const pf = byId.get(id);
                        return pf ? <PlatformBadge key={id} platform={pf} size={20} labelled /> : null;
                      })}
                    </span>
                  </span>
                  <StatusChip state={p.state} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------- Today's idea ----------

// Sample ideas (DESIGN.md: figures are placeholders). The API will supply these.
const IDEAS = [
  {
    idea: "Show the five minutes before an order leaves — tape, tissue, the handwritten note.",
    why: "Your packing posts get 2.3× the saves of product shots. Friday's drop is a good hook.",
  },
  {
    idea: "Answer the question customers DM you most, in one short post.",
    why: "Question posts tend to get comments, and comments help the next post reach further.",
  },
  {
    idea: "Put one customer's photo of their order front and centre, with their OK.",
    why: "Shout-outs give regulars a reason to tag you.",
  },
];

export function TodaysIdea() {
  const [i, setI] = useState(0);
  const { idea, why } = IDEAS[i];
  return (
    <section
      aria-labelledby="idea-h"
      className="flex flex-col gap-3.5 rounded-[20px] bg-forest p-[22px] text-forest-text"
    >
      <h2 id="idea-h" className="m-0 flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-lime uppercase">
        <SparkIcon size={16} />
        Today&apos;s idea
      </h2>
      <p aria-live="polite" className="m-0 font-display text-[22px] leading-tight font-bold tracking-[-0.02em] text-white">
        {idea}
      </p>
      <p className="m-0 text-sm text-forest-ink">{why}</p>
      <div className="flex flex-wrap gap-2.5">
        <ButtonLink href={composeHref(idea)} variant="lime">
          Use this idea
        </ButtonLink>
        <Button variant="ghostOnDark" onClick={() => setI((n) => (n + 1) % IDEAS.length)}>
          Another idea
        </Button>
      </div>
    </section>
  );
}

// ---------- Needs attention ----------

export function NeedsAttention({
  accounts,
  posts,
  platforms,
}: {
  accounts?: ConnectedAccount[];
  posts?: PostItem[];
  platforms?: PlatformConfig[];
}) {
  const broken = accounts?.filter((a) => a.status !== "connected") ?? [];
  if (broken.length === 0) return null;
  return (
    <>
      {broken.map((a) => {
        const name = platforms?.find((p) => p.id === a.platform)?.name ?? a.handle;
        const held =
          posts?.filter((p) => p.state !== "published" && p.platforms.includes(a.platform)).length ?? 0;
        return (
          <section
            key={a.id}
            aria-labelledby={`attn-${a.id}`}
            className="flex gap-3.5 rounded-[20px] border border-[#F2D9A6] bg-[#FFF6E5] p-[18px]"
          >
            <WarningTriangleIcon size={22} className="mt-0.5 shrink-0 text-[#6B4300]" />
            <div className="flex flex-col gap-2">
              <h2 id={`attn-${a.id}`} className="m-0 text-[15px] font-semibold text-[#4A2E00]">
                {name} needs reconnecting
              </h2>
              <p className="m-0 text-sm text-[#6B4300]">
                Access expired. {held > 0 ? `${held} scheduled post${held === 1 ? " is" : "s are"} on hold until you reconnect.` : "Reconnect before your next post."}
              </p>
              <ButtonLink href={ROUTES.connect} variant="outline" className="h-10 w-fit border-[#F2D9A6] text-[#4A2E00]">
                Reconnect
              </ButtonLink>
            </div>
          </section>
        );
      })}
    </>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={AlertIcon}
      tone="error"
      title="We couldn't load your home page"
      body="Check your connection and try again."
      action={<Button variant="outline" onClick={onRetry}>Try again</Button>}
    />
  );
}
