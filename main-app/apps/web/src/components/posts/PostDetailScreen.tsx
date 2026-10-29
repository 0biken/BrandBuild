"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge, StatusChip } from "@/components/ui/StatusChip";
import { useToast } from "@/components/ui/Toast";
import { AlertIcon, ArrowRightIcon, PauseIcon, RefreshIcon } from "@/components/ui/icons";
import { listPlatforms } from "@/lib/api/accounts";
import { invalidate, useQuery } from "@/lib/api/hooks";
import {
  deletePost,
  duplicateToDraft,
  getPost,
  reschedulePost,
  retryPost,
  withdrawApproval,
} from "@/lib/api/posts";
import type { PlatformConfig, PostItem } from "@/lib/api/types";
import { postDate } from "@/lib/postDates";
import { ROUTES } from "@/lib/routes";
import { RescheduleDialog } from "./RescheduleDialog";

type Tone = "primary" | "info" | "neutral" | "amber" | "danger";
type Row = { platform: PlatformConfig; status: string; tone: Tone; note: string; noteClass?: string };

/** Per-platform status rows, derived from the post's state (DESIGN: PostDetail). */
function platformRows(post: PostItem, platforms: PlatformConfig[]): Row[] {
  const list = post.platforms
    .map((id) => platforms.find((p) => p.id === id))
    .filter((p): p is PlatformConfig => !!p);
  const posted = `${post.dateStr.replace(/ \d{4}$/, "")}, ${post.time}`;
  return list.map((platform, i) => {
    const first = i === 0;
    switch (post.state) {
      case "scheduled":
        return { platform, status: "Scheduled", tone: "primary", note: platform.sub };
      case "approval":
        return { platform, status: "Waiting", tone: "info", note: platform.sub };
      case "published":
        return { platform, status: "Published", tone: "neutral", note: posted };
      case "paused":
        return { platform, status: "Held", tone: "neutral", note: "Publishing paused" };
      case "checking":
        return first
          ? { platform, status: "Checking", tone: "amber", note: `${platform.name} didn't confirm in time`, noteClass: "text-amber-ink" }
          : { platform, status: "Published", tone: "neutral", note: posted };
      case "failed":
        return first
          ? { platform, status: "Failed", tone: "danger", note: "Image ratio not supported", noteClass: "text-danger-ink" }
          : { platform, status: "Published", tone: "neutral", note: posted };
    }
  });
}

function Banner({
  tone,
  icon,
  title,
  children,
  actions,
}: {
  tone: "danger" | "info" | "amber" | "forest";
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const tones = {
    danger: "bg-danger-soft border-[#F4C7C3] text-danger-ink",
    info: "bg-info-soft border-[#C5DDF2] text-info-ink",
    amber: "bg-[#FFF6E5] border-[#F2D9A6] text-[#4A2E00]",
    forest: "bg-forest border-forest text-forest-text",
  };
  return (
    <section
      role={tone === "danger" ? "alert" : "status"}
      className={`flex flex-wrap items-start gap-3.5 rounded-[20px] border p-[18px] ${tones[tone]}`}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1">
        <span className={`text-[15px] font-semibold ${tone === "forest" ? "text-white" : ""}`}>{title}</span>
        <span className="text-sm opacity-90">{children}</span>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}

const section = "flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-5";
const h2 = "m-0 text-base font-semibold";

export function PostDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const post = useQuery(`posts:${id}`, () => getPost(id));
  const platforms = useQuery("platforms", listPlatforms);
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  if (post.error === "not_found") {
    return (
      <div className="mx-auto max-w-xl pt-10">
        <EmptyState
          icon={AlertIcon}
          title="We couldn't find that post"
          body="It may have been deleted."
          action={<ButtonLink href={ROUTES.calendar} variant="outline">Open calendar</ButtonLink>}
        />
      </div>
    );
  }
  if (post.error) {
    return (
      <div className="mx-auto max-w-xl pt-10">
        <EmptyState
          icon={AlertIcon}
          tone="error"
          title="We couldn't load this post"
          body="Check your connection and try again."
          action={<Button variant="outline" onClick={post.refetch}>Try again</Button>}
        />
      </div>
    );
  }
  if (!post.data || !platforms.data) {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-5" aria-busy="true">
        <Skeleton className="h-12 w-2/3" />
        <div className="grid gap-5 md:grid-cols-[420px_1fr]">
          <Skeleton className="h-[520px] rounded-[22px]" />
          <Skeleton className="h-[520px] rounded-[22px]" />
        </div>
      </div>
    );
  }

  const p = post.data;
  const rows = platformRows(p, platforms.data);
  const first = rows[0]?.platform;
  const handle = first?.sub.startsWith("@") ? first.sub.slice(1) : "novastudio.co";

  async function run(action: () => Promise<{ ok: boolean }>, success: string, after?: () => void) {
    setBusy(true);
    const res = await action();
    setBusy(false);
    invalidate("posts");
    invalidate("drafts");
    if (!res.ok) {
      toast({ tone: "error", message: "That didn't work. Try again." });
      return false;
    }
    toast({ tone: "success", message: success });
    after?.();
    return true;
  }

  const duplicate = () => run(() => duplicateToDraft(p.id), "Copied to Drafts");
  const editHref = `${ROUTES.compose}?post=${encodeURIComponent(p.id)}`;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3.5">
        <Link
          href={ROUTES.calendar}
          aria-label="Back to calendar"
          className="press inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink no-underline fine:bg-page-hover"
        >
          <ArrowRightIcon size={18} className="rotate-180" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 font-display text-[30px] leading-tight font-bold tracking-[-0.03em] max-md:text-[24px]">
            {p.title}
          </h1>
          <span className="text-sm text-muted">{p.scheduledFor}</span>
        </div>
        <StatusChip state={p.state} />
      </header>

      {p.state === "failed" && (
        <Banner
          tone="danger"
          icon={<AlertIcon size={22} />}
          title={p.failureInfo?.title ?? "This post didn't go out everywhere"}
          actions={
            <>
              <ButtonLink href={editHref} variant="outline" className="h-10">Crop and retry</ButtonLink>
              <Button
                variant="ghost"
                className="h-10"
                disabled={busy}
                onClick={() => run(() => retryPost(p.id), "Retrying now")}
              >
                Retry as is
              </Button>
            </>
          }
        >
          {p.failureInfo?.message ?? "One platform rejected the post. The others posted fine."}
        </Banner>
      )}
      {p.state === "approval" && (
        <Banner
          tone="info"
          title={`Waiting for ${p.reviewer?.name ?? "the owner"} to approve`}
          actions={<ButtonLink href={ROUTES.approvals} variant="outline" className="h-10">Review now</ButtonLink>}
        >
          {p.reviewer?.note ??
            "It goes out at its scheduled time once approved. If it isn't approved by then, it waits."}
        </Banner>
      )}
      {p.state === "checking" && (
        <Banner tone="amber" icon={<RefreshIcon size={22} />} title={p.checkingInfo?.title ?? "Checking whether this posted"}>
          {p.checkingInfo?.message ??
            "The platform didn't confirm in time. Please don't post it again yourself, or it may appear twice."}
        </Banner>
      )}
      {p.state === "paused" && (
        <Banner
          tone="forest"
          icon={<PauseIcon size={22} className="text-lime" />}
          title={p.pausedInfo?.title ?? "Publishing is paused for this workspace"}
          actions={
            <ButtonLink href="/legal#contact" variant="lime" className="h-10">Contact support</ButtonLink>
          }
        >
          {p.pausedInfo?.message ??
            "[REASON]. This post is held and will go out when publishing resumes, unless its time has passed."}
        </Banner>
      )}

      <div className="grid items-start gap-5 md:grid-cols-[420px_minmax(0,1fr)]">
        <section aria-label="Post preview" className="overflow-hidden rounded-[22px] border border-line bg-surface">
          <div className="flex items-center gap-2.5 p-3.5">
            <span
              aria-hidden="true"
              className="inline-flex size-9 items-center justify-center rounded-full bg-forest font-display font-bold text-lime"
            >
              N
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{handle}</span>
              <span className="text-xs text-muted">{first?.name}</span>
            </span>
          </div>
          <div
            role="img"
            aria-label="Post image placeholder"
            className="flex items-center justify-center bg-[#DCE6DE] text-[13px] text-ink-2"
            style={{ aspectRatio: p.aspectRatio }}
          >
            [PHOTO]
          </div>
          <p className="m-0 p-3.5 text-sm leading-relaxed whitespace-pre-line">
            <strong className="font-semibold">{handle}</strong> {p.caption}
            {p.hashtags.length > 0 && (
              <>
                <br />
                <span className="text-[#0A5CA8]">{p.hashtags.join(" ")}</span>
              </>
            )}
          </p>
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="pf-h" className={section}>
            <h2 id="pf-h" className={h2}>Platforms</h2>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {rows.map((r) => (
                <li key={r.platform.id} className="flex items-center gap-3">
                  <PlatformBadge platform={r.platform} size={32} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-semibold">{r.platform.name}</span>
                    <span className={`text-[13px] ${r.noteClass ?? "text-muted"}`}>{r.note}</span>
                  </span>
                  <Badge tone={r.tone}>{r.status}</Badge>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="perf-h" className={section}>
            <div className="flex items-baseline gap-2">
              <h2 id="perf-h" className={h2}>Performance</h2>
              {p.state === "published" && <span className="text-[13px] text-muted">first 48 hours</span>}
            </div>
            {p.state === "published" && p.metrics ? (
              <>
                <dl className="m-0 grid grid-cols-4 gap-3 max-md:grid-cols-2">
                  {(
                    [
                      ["Reach", p.metrics.reach],
                      ["Likes", p.metrics.likes],
                      ["Comments", p.metrics.comments],
                      ["Saves", p.metrics.saves],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="flex flex-col-reverse rounded-2xl bg-surface-2 p-3.5">
                      <dt className="text-[13px] text-muted">{label}</dt>
                      <dd className="m-0 font-display text-[26px] font-bold tracking-[-0.02em]">{value}</dd>
                    </div>
                  ))}
                </dl>
                {p.metrics.note && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary-soft p-3.5 text-sm text-primary-ink">
                    <span>{p.metrics.note}</span>
                    <Link href={`${ROUTES.compose}?idea=${encodeURIComponent(p.title)}`} className="font-semibold">
                      Make a similar post
                    </Link>
                  </div>
                )}
              </>
            ) : (
              <span className="text-sm text-muted">Results show up here once the post is live.</span>
            )}
          </section>

          <section aria-labelledby="act-h" className={section}>
            <h2 id="act-h" className={h2}>Activity</h2>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {p.activityLog.map((l, i) => (
                <li key={i} className="flex items-start gap-3 text-sm">
                  <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: l.dot }} />
                  <span className="flex-1">{l.text}</span>
                  <span className="shrink-0 font-mono text-xs text-muted">{l.time}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="flex flex-wrap gap-2.5">
            {p.state === "scheduled" && (
              <Button variant="outline" onClick={() => setRescheduling(true)}>Reschedule</Button>
            )}
            {["scheduled", "approval", "paused"].includes(p.state) && (
              <ButtonLink href={editHref} variant="outline">Edit</ButtonLink>
            )}
            {["scheduled", "published", "checking", "failed"].includes(p.state) && (
              <Button variant="outline" onClick={duplicate} disabled={busy}>Duplicate</Button>
            )}
            {p.state === "approval" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run(() => withdrawApproval(p.id), "Request withdrawn. The post is back in Drafts.", () => router.push(ROUTES.drafts))}
              >
                Withdraw request
              </Button>
            )}
            {["scheduled", "paused", "failed"].includes(p.state) && (
              <Button variant="dangerOutline" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      <RescheduleDialog
        open={rescheduling}
        onClose={() => setRescheduling(false)}
        initial={postDate(p)}
        onSave={(when) => run(() => reschedulePost(p.id, when), "Rescheduled")}
      />
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this post?"
        description="It won't be published, and it's removed from your calendar. This can't be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                run(() => deletePost(p.id), "Post deleted", () => {
                  setConfirmDelete(false);
                  router.push(ROUTES.calendar);
                })
              }
            >
              Delete post
            </Button>
          </>
        }
      />
    </div>
  );
}
