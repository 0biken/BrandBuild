"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Textarea } from "@/components/ui/FormControls";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/StatusChip";
import { useToast } from "@/components/ui/Toast";
import { AlertIcon, ApprovalsIcon, ArrowRightIcon } from "@/components/ui/icons";
import { listPlatforms } from "@/lib/api/accounts";
import {
  approvePost,
  listApprovals,
  rejectPost,
  requestChanges,
  undoDecision,
  type Decision,
  type DecisionReceipt,
} from "@/lib/api/approvals";
import { getSession } from "@/lib/api/auth";
import { invalidate, useQuery } from "@/lib/api/hooks";
import type { PlatformConfig, PostItem } from "@/lib/api/types";
import { postTimestamp, shortWhen, timeAgo } from "@/lib/postDates";
import { ROUTES } from "@/lib/routes";
import { useNow } from "@/lib/useNow";

type Status = Decision | "waiting";

const CHIP: Record<Status, { label: string; tone: "info" | "primary" | "amber" | "danger" }> = {
  waiting: { label: "Waiting", tone: "info" },
  approve: { label: "Approved", tone: "primary" },
  changes: { label: "Changes asked", tone: "amber" },
  reject: { label: "Rejected", tone: "danger" },
};

const DONE_TONE: Record<Decision, string> = {
  approve: "bg-primary-soft text-primary-ink",
  changes: "bg-amber-soft text-amber-ink",
  reject: "bg-danger-soft text-danger-ink",
};

/** Quick notes from the phone design; tapping one adds it to the note. */
const QUICK_NOTES = ["Different photo", "Shorter caption", "Change the time"];

const sender = (p: PostItem) => p.requestedBy?.name ?? "the sender";

function doneText(r: DecisionReceipt): string {
  const who = sender(r.before);
  if (r.decision === "approve") {
    return `Approved. Scheduled for ${shortWhen(r.post ?? r.before)}. ${who} has been told.`;
  }
  if (r.decision === "changes") return `Sent back to ${who} with your note. It's in Drafts until they send it again.`;
  return `Rejected. ${who} has been told and the post is back in Drafts. It won't go out.`;
}

export function ApprovalsScreen({ initialId }: { initialId?: string }) {
  const toast = useToast();
  const now = useNow();
  const approvals = useQuery("approvals", listApprovals);
  const session = useQuery("session", getSession);
  const platforms = useQuery("platforms", listPlatforms);

  // Posts decided on this visit stay listed with their outcome, so Undo has
  // something to point at. Undone ones stay too until the refetch lands.
  const [seen, setSeen] = useState<Record<string, { receipt: DecisionReceipt; status: Status }>>({});
  const [picked, setPicked] = useState(initialId);
  // Phone only: the list and the review are separate views.
  const [reviewing, setReviewing] = useState(!!initialId);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const live = approvals.data ?? [];
  const items = [
    ...live,
    ...Object.values(seen)
      .map((s) => s.receipt.before)
      .filter((p) => !live.some((l) => l.id === p.id)),
  ].sort((a, b) => postTimestamp(a) - postTimestamp(b));
  const status = (id: string): Status => seen[id]?.status ?? "waiting";
  const waitingItems = items.filter((p) => status(p.id) === "waiting");
  const current = items.find((p) => p.id === picked) ?? waitingItems[0] ?? items[0];
  const canDecide = session.data ? session.data.role !== "editor" : false;

  function pick(id: string) {
    setPicked(id);
    setReviewing(true);
    setAsking(false);
    setNote("");
  }

  function refresh() {
    invalidate("approvals");
    invalidate("posts");
    invalidate("drafts");
  }

  async function decide(p: PostItem, decision: Decision) {
    setBusy(true);
    const res =
      decision === "approve"
        ? await approvePost(p.id)
        : decision === "changes"
          ? await requestChanges(p.id, note)
          : await rejectPost(p.id);
    setBusy(false);
    refresh();
    if (!res.ok) {
      toast({
        tone: "error",
        message:
          res.error === "forbidden"
            ? "Only the owner or a reviewer can do that."
            : res.error === "conflict"
              ? "Someone already dealt with this post."
              : "That didn't work. Try again.",
      });
      return;
    }
    setSeen((s) => ({ ...s, [p.id]: { receipt: res.data, status: decision } }));
    setAsking(false);
    setNote("");
  }

  async function undo(r: DecisionReceipt) {
    setBusy(true);
    const res = await undoDecision(r);
    setBusy(false);
    refresh();
    if (!res.ok) {
      toast({ tone: "error", message: "We couldn't undo that. It may have changed since." });
      return;
    }
    setSeen((s) => ({ ...s, [r.postId]: { receipt: r, status: "waiting" } }));
  }

  function nextWaiting() {
    const next = waitingItems.find((p) => p.id !== current?.id);
    if (next) pick(next.id);
    else setReviewing(false);
  }

  const oldest = waitingItems
    .map((p) => p.requestedAt)
    .filter((t): t is string => !!t)
    .sort()[0];
  const subline = !approvals.data
    ? ""
    : waitingItems.length === 0
      ? "All caught up"
      : `${waitingItems.length} waiting ${canDecide ? "for you" : "for approval"}${
          oldest && now ? ` · oldest sent ${timeAgo(oldest, now)}` : ""
        }`;

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-[18px]">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="m-0 font-display text-[34px] font-bold tracking-[-0.03em] max-md:text-[28px]">Approvals</h1>
        <span className="text-[15px] text-muted" aria-live="polite">{subline}</span>
      </header>

      {approvals.error ? (
        <EmptyState
          icon={AlertIcon}
          tone="error"
          title="We couldn't load your approvals"
          body="Check your connection and try again."
          action={<Button variant="outline" onClick={approvals.refetch}>Try again</Button>}
        />
      ) : !approvals.data || !platforms.data ? (
        <div className="flex flex-wrap items-start gap-5" aria-busy="true">
          <Skeleton className="h-[300px] flex-[1_1_340px] rounded-[20px]" />
          <Skeleton className="h-[520px] flex-[2_1_560px] rounded-[20px] max-md:hidden" />
        </div>
      ) : items.length === 0 || !current ? (
        <EmptyState
          icon={ApprovalsIcon}
          title="Nothing to approve"
          body="When someone sends a post for approval, it shows up here. Nothing posts until it's approved."
          action={<ButtonLink href={ROUTES.calendar} variant="outline">Open calendar</ButtonLink>}
        />
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <section
            aria-label="Posts to review"
            className={`flex min-w-0 flex-[1_1_340px] flex-col gap-1 rounded-[20px] border border-line bg-surface p-2 ${
              reviewing ? "max-md:hidden" : ""
            }`}
          >
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {items.map((p) => {
                const on = p.id === current.id;
                const chip = CHIP[status(p.id)];
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pick(p.id)}
                      aria-current={on ? "true" : undefined}
                      className={`press flex min-h-11 w-full cursor-pointer flex-col gap-1.5 rounded-[14px] border-0 p-3.5 text-left font-sans ${
                        on ? "bg-primary-soft/50 shadow-[inset_0_0_0_2px_#12A150]" : "bg-transparent fine:bg-page-hover"
                      }`}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <Platforms ids={p.platforms} platforms={platforms.data!} size={22} />
                        <Badge tone={chip.tone} className="ml-auto">{chip.label}</Badge>
                      </span>
                      <span className="text-[15px] font-semibold text-ink">{p.title}</span>
                      <span className="text-[13px] text-muted">
                        {p.requestedAt && now ? `Sent ${timeAgo(p.requestedAt, now)} · ` : ""}
                        {shortWhen(p)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="m-0 px-3 py-2.5 text-[13px] text-muted">
              Nothing posts until it&apos;s approved. The sender is told either way.
            </p>
          </section>

          <section
            aria-label="Review"
            className={`flex min-w-0 flex-[2_1_560px] flex-col gap-4 rounded-[20px] border border-line bg-surface p-[22px] max-md:p-4 ${
              reviewing ? "" : "max-md:hidden"
            }`}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setReviewing(false)}
                aria-label="Back to approvals"
                className="press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-2 text-ink md:hidden"
              >
                <ArrowRightIcon size={18} className="rotate-180" />
              </button>
              {current.requestedBy && <Avatar name={current.requestedBy.name} size={36} />}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <strong className="text-[15px]">
                  {current.requestedBy ? `${current.requestedBy.name} sent this for approval` : "Sent for approval"}
                </strong>
                <span className="text-[13px] text-muted">
                  {current.requestedAt && now ? `Sent ${timeAgo(current.requestedAt, now)} · ` : ""}
                  wants it to go out {shortWhen(current)}
                </span>
              </span>
            </div>

            <div className="flex flex-wrap gap-4">
              <div className="flex-[1_1_260px] overflow-hidden rounded-[18px] border border-line">
                <div
                  role="img"
                  aria-label="Post image placeholder"
                  className="flex items-center justify-center bg-[#DCE6DE] text-[13px] text-ink-2"
                  style={{ aspectRatio: current.aspectRatio }}
                >
                  [PHOTO]
                </div>
              </div>
              <div className="flex flex-[1.3_1_300px] flex-col gap-2.5">
                <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">{current.title}</h2>
                <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Caption</span>
                <p className="m-0 text-[15px] leading-relaxed whitespace-pre-line">{current.caption}</p>
                {current.hashtags.length > 0 && (
                  <p className="m-0 text-sm text-[#0A5CA8]">{current.hashtags.join(" ")}</p>
                )}
                <span className="flex items-center gap-1.5 pt-1">
                  <Platforms ids={current.platforms} platforms={platforms.data} size={24} labelled />
                </span>
                {status(current.id) === "waiting" && (
                  <Link
                    href={`${ROUTES.compose}?post=${encodeURIComponent(current.id)}`}
                    className="mt-1 self-start text-sm font-semibold"
                  >
                    {canDecide ? "Edit before approving" : "Edit"}
                  </Link>
                )}
              </div>
            </div>

            {status(current.id) === "waiting" ? (
              canDecide ? (
                <div className="flex flex-col gap-3 border-t border-line pt-3">
                  {asking && (
                    <div className="flex flex-col gap-2.5">
                      <Textarea
                        id="change-note"
                        label={`What should ${sender(current)} change?`}
                        rows={3}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        autoFocus
                      />
                      <div className="flex flex-wrap gap-2">
                        {QUICK_NOTES.map((q) => (
                          <Button
                            key={q}
                            variant="soft"
                            className="h-10 px-3 text-sm"
                            onClick={() => setNote((n) => (n.trim() ? `${n.trim()} ${q}.` : `${q}.`))}
                          >
                            {q}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2.5">
                    {!asking && (
                      <Button size="lg" disabled={busy} onClick={() => decide(current, "approve")}>
                        Approve and schedule
                      </Button>
                    )}
                    <Button
                      size="lg"
                      variant={asking ? "primary" : "outline"}
                      disabled={busy || (asking && !note.trim())}
                      onClick={() => (asking ? decide(current, "changes") : setAsking(true))}
                    >
                      {asking ? `Send to ${sender(current)}` : "Request changes"}
                    </Button>
                    {asking ? (
                      <Button size="lg" variant="ghost" onClick={() => { setAsking(false); setNote(""); }}>
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        variant="ghost"
                        className="ml-auto text-danger-ink"
                        disabled={busy}
                        onClick={() => decide(current, "reject")}
                      >
                        Reject
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="m-0 rounded-[14px] bg-info-soft p-3.5 text-[15px] text-info-ink">
                  Waiting for {current.reviewer?.name ?? "the owner"} to approve. Only the owner or a reviewer can
                  approve posts.
                </p>
              )
            ) : (
              <div
                role="status"
                className={`flex flex-wrap items-center gap-3 rounded-[14px] px-4 py-3.5 text-[15px] ${
                  DONE_TONE[seen[current.id].receipt.decision]
                }`}
              >
                <span className="flex-[1_1_240px]">{doneText(seen[current.id].receipt)}</span>
                <Button
                  variant="outline"
                  className="h-10 px-3 text-sm"
                  disabled={busy}
                  onClick={() => undo(seen[current.id].receipt)}
                >
                  Undo
                </Button>
                {waitingItems.length > 0 && (
                  <Button className="h-10 px-3 text-sm" onClick={nextWaiting}>
                    Next post ({waitingItems.length} left)
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Platforms({
  ids,
  platforms,
  size,
  labelled,
}: {
  ids: PostItem["platforms"];
  platforms: PlatformConfig[];
  size: number;
  labelled?: boolean;
}) {
  return (
    <>
      {ids.map((id) => {
        const p = platforms.find((x) => x.id === id);
        return p ? <PlatformBadge key={id} platform={p} size={size} labelled={labelled} /> : null;
      })}
    </>
  );
}
