"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type DragEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { POST_STATE, StatusChip } from "@/components/ui/StatusChip";
import { useToast } from "@/components/ui/Toast";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon, DraftsIcon, GripVerticalIcon, SparkIcon } from "@/components/ui/icons";
import { listPlatforms } from "@/lib/api/accounts";
import { listDrafts } from "@/lib/api/drafts";
import { invalidate, useQuery } from "@/lib/api/hooks";
import { listPosts, reschedulePost } from "@/lib/api/posts";
import type { PlatformId, PostItem, PostState } from "@/lib/api/types";
import { formatShort, isPast, isoDay, postDate } from "@/lib/postDates";
import { ROUTES } from "@/lib/routes";
import { useNow } from "@/lib/useNow";

type View = "month" | "week" | "list";

const DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MOVABLE: PostState[] = ["scheduled", "approval", "paused"];

/** Chip colours per state (Calendar design). The state is also given in text. */
const CHIP: Record<PostState, string> = {
  scheduled: "bg-primary-soft text-[#0B3D20] shadow-[inset_0_0_0_1px_#9ED3B2]",
  approval: "bg-info-soft text-info-ink shadow-[inset_0_0_0_1px_#A9CBEE]",
  published: "bg-[#F0F1EC] text-muted",
  paused: "bg-[#FFF1D6] text-[#4A2E00] shadow-[inset_0_0_0_1px_#E5C98F]",
  checking: "bg-[#FFF1D6] text-[#4A2E00] shadow-[inset_0_0_0_1px_#E5C98F]",
  failed: "bg-danger-soft text-danger-ink shadow-[inset_0_0_0_1px_#F4C7C3]",
};

const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const DND_POST = "application/x-bb-post";
const DND_DRAFT = "application/x-bb-draft";

export function CalendarScreen() {
  const router = useRouter();
  const toast = useToast();
  const now = useNow();
  const posts = useQuery("posts", listPosts);
  const drafts = useQuery("drafts", listDrafts);
  const platforms = useQuery("platforms", listPlatforms);

  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<Date | null>(null);
  const [hidden, setHidden] = useState<PlatformId[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Placeholder until the client clock is known; a skeleton shows meanwhile.
  const today = now ?? new Date(0);
  const anchor = cursor ?? today;
  const todayKey = isoDay(today);
  const selectedKey = selected ?? todayKey;

  const visible = useMemo(
    () => (posts.data ?? []).filter((p) => p.platforms.some((id) => !hidden.includes(id))),
    [posts.data, hidden],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, PostItem[]>();
    for (const p of [...visible].sort((a, b) => postDate(a).getTime() - postDate(b).getTime())) {
      const k = isoDay(postDate(p));
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [visible]);
  const pfById = new Map(platforms.data?.map((p) => [p.id, p]));

  // ----- ranges -----
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const weeks = Math.ceil(((monthEnd.getTime() - gridStart.getTime()) / 86_400_000 + 1) / 7);
  const monthDays = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const weekStart = startOfWeek(anchor);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function step(dir: 1 | -1) {
    setCursor(
      view === "week"
        ? addDays(anchor, 7 * dir)
        : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1),
    );
  }

  const title =
    view === "week"
      ? `${weekDays[0].getDate()} ${MONTHS[weekDays[0].getMonth()].slice(0, 3)} – ${weekDays[6].getDate()} ${MONTHS[weekDays[6].getMonth()].slice(0, 3)}`
      : MONTHS[anchor.getMonth()];

  // ----- gap: next 7 days with nothing planned -----
  const gaps = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1)).filter(
    (d) => !(posts.data ?? []).some((p) => p.state !== "published" && isoDay(postDate(p)) === isoDay(d)),
  );

  // ----- drag and drop -----
  async function moveTo(postId: string, day: Date) {
    const post = posts.data?.find((p) => p.id === postId);
    if (!post) return;
    const from = postDate(post);
    const to = new Date(day.getFullYear(), day.getMonth(), day.getDate(), from.getHours(), from.getMinutes());
    if (isoDay(to) === isoDay(from)) return;
    if (isPast(to)) {
      toast({ tone: "error", message: "That day has passed. Pick a day in the future." });
      return;
    }
    const res = await reschedulePost(postId, to);
    invalidate("posts");
    if (!res.ok) {
      toast({ tone: "error", message: "We couldn't move that post. Try again." });
      return;
    }
    toast({
      tone: "success",
      message: `Moved "${post.title}" to ${formatShort(to)}`,
      action: {
        label: "Undo",
        onAction: async () => {
          await reschedulePost(postId, from);
          invalidate("posts");
        },
      },
    });
  }

  function onDrop(e: DragEvent, day: Date) {
    e.preventDefault();
    setDropTarget(null);
    const postId = e.dataTransfer.getData(DND_POST);
    const draftId = e.dataTransfer.getData(DND_DRAFT);
    if (postId) moveTo(postId, day);
    else if (draftId) router.push(`${ROUTES.compose}?draft=${encodeURIComponent(draftId)}&date=${isoDay(day)}`);
  }

  const dropProps = (day: Date) => ({
    onDragOver: (e: DragEvent) => {
      if ([DND_POST, DND_DRAFT].some((t) => e.dataTransfer.types.includes(t))) {
        e.preventDefault();
        setDropTarget(isoDay(day));
      }
    },
    onDragLeave: () => setDropTarget((k) => (k === isoDay(day) ? null : k)),
    onDrop: (e: DragEvent) => onDrop(e, day),
  });

  const chip = (p: PostItem, compact = false) => {
    const movable = MOVABLE.includes(p.state);
    return (
      <Link
        key={p.id}
        href={ROUTES.post(p.id)}
        draggable={movable}
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_POST, p.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        className={`flex min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-xs no-underline ${CHIP[p.state]} ${
          movable ? "cursor-grab active:cursor-grabbing" : ""
        } ${compact ? "max-md:hidden" : ""}`}
      >
        <span className="flex items-center gap-1">
          {p.platforms.map((id) => (
            <span key={id} aria-hidden="true" className="size-2 rounded-full" style={{ background: pfById.get(id)?.bg }} />
          ))}
          <span className="font-mono text-[11px]">{p.time}</span>
        </span>
        <span className="truncate font-semibold">{p.title}</span>
        <span className="sr-only">
          , {POST_STATE[p.state].label}, {p.platforms.map((id) => pfById.get(id)?.name).join(", ")}
        </span>
      </Link>
    );
  };

  const selectedDate = (() => {
    const [y, m, d] = selectedKey.split("-").map(Number);
    return new Date(y, m - 1, d);
  })();
  const selectedPosts = byDay.get(selectedKey) ?? [];

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 mr-auto font-display text-[34px] font-bold tracking-[-0.03em] max-md:text-[28px]">
          {now ? title : "Calendar"}{" "}
          {now && view !== "week" && <span className="text-[#7D877F]">{anchor.getFullYear()}</span>}
        </h1>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
            onClick={() => step(-1)}
            className="press inline-flex size-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-2 text-ink fine:bg-page-hover"
          >
            <ChevronLeftIcon size={18} />
          </button>
          <button
            type="button"
            aria-label={view === "week" ? "Next week" : "Next month"}
            onClick={() => step(1)}
            className="press inline-flex size-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-2 text-ink fine:bg-page-hover"
          >
            <ChevronRightIcon size={18} />
          </button>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setCursor(null);
            setSelected(null);
          }}
        >
          Today
        </Button>
        <div role="radiogroup" aria-label="View" className="flex gap-1 rounded-xl bg-page-hover p-1">
          {(["month", "week", "list"] as const).map((v) => (
            <label
              key={v}
              className={`inline-flex min-h-9 cursor-pointer items-center rounded-lg px-3.5 text-sm font-semibold capitalize has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                view === v ? "bg-surface text-ink shadow-sm" : "text-ink-2"
              }`}
            >
              <input type="radio" name="view" checked={view === v} onChange={() => setView(v)} className="sr-only" />
              {v}
            </label>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Show</span>
        {platforms.data
          ?.filter((p) => !p.off)
          .map((p) => {
            const on = !hidden.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => setHidden((h) => (on ? [...h, p.id] : h.filter((x) => x !== p.id)))}
                className={`press inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border-0 px-3 font-semibold ${
                  on ? "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "bg-transparent text-muted line-through"
                }`}
              >
                <span aria-hidden="true" className="size-2 rounded-full" style={{ background: p.bg }} />
                {p.name}
              </button>
            );
          })}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-muted max-md:ml-0">
          {(["scheduled", "paused", "approval", "published"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-3 rounded-sm ring-1 ring-ink/25 ${CHIP[s].split(" ")[0]}`} />
              {s === "paused" ? "On hold" : POST_STATE[s].label}
            </span>
          ))}
        </span>
      </div>

      {posts.error ? (
        <EmptyState
          icon={AlertIcon}
          tone="error"
          title="We couldn't load your calendar"
          body="Check your connection and try again."
          action={<Button variant="outline" onClick={posts.refetch}>Try again</Button>}
        />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            {!posts.data || !now ? (
              <Skeleton className="h-[620px] rounded-[20px]" />
            ) : view === "list" ? (
              <ListView byDay={byDay} anchor={anchor} pfById={pfById} />
            ) : (
              <section
                aria-label={view === "week" ? `Week of ${formatShort(weekStart).split(",")[0]}` : `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`}
                className="overflow-hidden rounded-[20px] border border-line bg-surface"
              >
                <div className="grid grid-cols-7 border-b border-[#EEF0EA]">
                  {DOWS.map((d) => (
                    <div key={d} className="px-3 py-2.5 text-xs font-semibold text-muted max-md:px-1 max-md:text-center">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {(view === "week" ? weekDays : monthDays).map((d, i, arr) => {
                    const key = isoDay(d);
                    const inMonth = view === "week" || d.getMonth() === anchor.getMonth();
                    const dayPosts = byDay.get(key) ?? [];
                    const isToday = key === todayKey;
                    const isSel = key === selectedKey;
                    return (
                      <div
                        key={key}
                        {...dropProps(d)}
                        className={`relative flex flex-col gap-1.5 p-2 ${view === "week" ? "min-h-[420px]" : "min-h-32 max-md:min-h-16"} ${
                          i % 7 !== 6 ? "border-r border-[#EEF0EA]" : ""
                        } ${i < arr.length - 7 ? "border-b border-[#EEF0EA]" : ""} ${
                          dropTarget === key ? "bg-[#F2FAF5] shadow-[inset_0_0_0_2px_var(--color-primary)]" : inMonth ? "bg-surface" : "bg-[#FAFAF7]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelected(key)}
                          aria-pressed={isSel}
                          aria-label={`${formatShort(d).split(",")[0]}, ${dayPosts.length} post${dayPosts.length === 1 ? "" : "s"}`}
                          className={`inline-flex size-7 cursor-pointer items-center justify-center self-start rounded-full border-0 text-[13px] font-semibold max-md:self-center ${
                            isToday
                              ? "bg-primary-strong text-white"
                              : isSel
                                ? "bg-ink text-white"
                                : inMonth
                                  ? "bg-transparent text-ink fine:bg-page-hover"
                                  : "bg-transparent text-muted"
                          }`}
                        >
                          {d.getDate()}
                        </button>
                        {dayPosts.map((p) => chip(p, view === "month"))}
                        {view === "month" && dayPosts.length > 0 && (
                          <span aria-hidden="true" className="hidden justify-center gap-0.5 max-md:flex">
                            {dayPosts.slice(0, 3).map((p) => (
                              <span key={p.id} className={`size-1.5 rounded-full ${CHIP[p.state].split(" ")[0]} ring-1 ring-ink/20`} />
                            ))}
                          </span>
                        )}
                        {dropTarget === key && (
                          <span className="text-xs font-semibold text-primary-hover">Drop to move here</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {view !== "list" && posts.data && now && (
              <section aria-labelledby="day-h" aria-live="polite" className="flex flex-col gap-2 rounded-[20px] border border-line bg-surface p-4">
                <h2 id="day-h" className="m-0 text-base font-semibold">
                  {formatShort(selectedDate).split(",")[0]}
                </h2>
                {selectedPosts.length === 0 ? (
                  <p className="m-0 flex flex-wrap items-center gap-3 text-sm text-muted">
                    Nothing planned.
                    <Link href={`${ROUTES.compose}?date=${selectedKey}`} className="font-semibold">Plan a post</Link>
                  </p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {selectedPosts.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={ROUTES.post(p.id)}
                          className="flex items-center gap-3 rounded-xl px-2 py-2 text-ink no-underline fine:bg-surface-2"
                        >
                          <span className="w-16 font-mono text-[13px] text-muted">{p.time}</span>
                          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.title}</span>
                          <StatusChip state={p.state} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="m-0 text-xs text-muted">
                  Drag a scheduled post to another day to move it, or open it and choose Reschedule. Times are in{" "}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}.
                </p>
              </section>
            )}
          </div>

          <aside aria-label="Drafts and suggestions" className="flex flex-col gap-4">
            <section className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="m-0 text-base font-semibold">Drafts</h2>
                <span className="text-xs text-muted max-md:hidden">drag onto a day</span>
              </div>
              {!drafts.data ? (
                <Skeleton className="h-32" />
              ) : drafts.data.length === 0 ? (
                <EmptyState icon={DraftsIcon} title="No drafts" />
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {drafts.data.slice(0, 4).map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`${ROUTES.compose}?draft=${encodeURIComponent(d.id)}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DND_DRAFT, d.id);
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        className="flex cursor-grab items-center gap-2 rounded-xl bg-surface-2 p-2.5 text-ink no-underline active:cursor-grabbing"
                      >
                        <GripVerticalIcon size={16} className="shrink-0 text-muted" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-semibold">{d.title}</span>
                          <span className="text-xs text-muted">{d.state}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {posts.data && now && gaps.length > 0 && (
              <section className="flex flex-col gap-3 rounded-[20px] bg-forest p-[18px] text-forest-text">
                <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-lime uppercase">
                  <SparkIcon size={15} />
                  Gap spotted
                </span>
                <p className="m-0 font-display text-lg leading-snug font-bold text-white">
                  Nothing is planned for {gaps.slice(0, 2).map((d) => formatShort(d).split(",")[0]).join(" or ")}.
                </p>
                <ButtonLink
                  href={`${ROUTES.compose}?date=${isoDay(gaps[0])}`}
                  variant="lime"
                  className="h-10 w-fit"
                >
                  Plan a post
                </ButtonLink>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function ListView({
  byDay,
  anchor,
  pfById,
}: {
  byDay: Map<string, PostItem[]>;
  anchor: Date;
  pfById: Map<PlatformId, { k: string; bg: string; name: string }>;
}) {
  const month = [...byDay.entries()].filter(([k]) => {
    const [y, m] = k.split("-").map(Number);
    return y === anchor.getFullYear() && m === anchor.getMonth() + 1;
  });
  if (month.length === 0) {
    return <EmptyState title="Nothing this month" body="Posts you schedule show up here." />;
  }
  return (
    <section aria-label="Posts this month" className="flex flex-col gap-4">
      {month.map(([k, list]) => {
        const [y, m, d] = k.split("-").map(Number);
        return (
          <div key={k} className="overflow-hidden rounded-[20px] border border-line bg-surface">
            <h2 className="m-0 border-b border-[#EEF0EA] px-4 py-2.5 text-sm font-semibold">
              {formatShort(new Date(y, m - 1, d)).split(",")[0]}
            </h2>
            <ul className="m-0 list-none p-0">
              {list.map((p) => (
                <li key={p.id}>
                  <Link
                    href={ROUTES.post(p.id)}
                    className="flex items-center gap-3 px-4 py-3 text-ink no-underline fine:bg-surface-2 max-md:flex-wrap"
                  >
                    <span className="w-16 font-mono text-[13px] text-muted">{p.time}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.title}</span>
                    <span className="flex gap-1">
                      {p.platforms.map((id) => {
                        const pf = pfById.get(id);
                        return pf ? <PlatformBadge key={id} platform={pf} size={20} labelled /> : null;
                      })}
                    </span>
                    <StatusChip state={p.state} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
