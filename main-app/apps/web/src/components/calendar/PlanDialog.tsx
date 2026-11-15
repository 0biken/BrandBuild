"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/FormControls";
import { SparkIcon } from "@/components/ui/icons";
import { PLATFORM_META } from "@/lib/api/adapt";
import { invalidate } from "@/lib/api/hooks";
import { cancelRun, createPlan, getRun, isActive, validGoal } from "@/lib/api/plans";
import type { AgentRun, ApiError, PlatformId } from "@/lib/api/types";
import { isoDay } from "@/lib/postDates";

const STEP: Record<string, string> = {
  queued: "Getting started…",
  context_loading: "Reading your brand and facts…",
  planning: "Planning your weeks…",
  generating: "Writing captions…",
  validating: "Checking every claim against your facts…",
};

const START_ERROR: Partial<Record<ApiError, string>> = {
  unavailable: "AI planning isn't switched on for this workspace yet. You can still plan posts by hand.",
  budget: "This workspace has used its AI budget for the month. You can still plan posts by hand.",
  forbidden: "Only owners and editors can start a plan.",
  invalid: "Check the goal, weeks and platforms, then try again.",
};

const POLL_MS = 1500;

/**
 * "Plan my weeks": a goal form, then a progress view while the plan runs, then a
 * summary of what was saved and what was held back (and why).
 */
export function PlanDialog({
  open,
  onClose,
  platforms,
  today,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  platforms: { id: PlatformId; name: string }[];
  today: Date;
  onDone: (run: AgentRun) => void;
}) {
  const [goal, setGoal] = useState("");
  const [weeks, setWeeks] = useState<2 | 4>(2);
  const [picked, setPicked] = useState<PlatformId[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chosen = picked.length ? picked : platforms.map((p) => p.id);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const input = { goal: goal.trim(), weeks, platforms: chosen, startDate: isoDay(tomorrow) };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function poll(id: string) {
    timer.current = setTimeout(async () => {
      const res = await getRun(id);
      if (!res.ok) {
        setError("We lost track of the plan. Check your drafts in a minute.");
        return;
      }
      setRun(res.data);
      if (isActive(res.data)) poll(id);
      else {
        invalidate("drafts");
        onDone(res.data);
      }
    }, POLL_MS);
  }

  async function start() {
    setError(null);
    setBusy(true);
    const res = await createPlan(input);
    setBusy(false);
    if (!res.ok) {
      setError(START_ERROR[res.error] ?? "We couldn't start the plan. Try again.");
      return;
    }
    setRun({ id: res.data.runId, kind: "plan", status: "queued", draftIds: [], dropped: [], warnings: [], createdAt: new Date().toISOString() });
    poll(res.data.runId);
  }

  async function cancel() {
    if (!run) return;
    if (timer.current) clearTimeout(timer.current);
    const res = await cancelRun(run.id);
    if (res.ok) setRun(res.data);
    else poll(run.id); // It finished first; show what it made.
  }

  function close() {
    if (run && isActive(run)) return; // Cancel first, so nothing lands unseen.
    if (timer.current) clearTimeout(timer.current);
    setRun(null);
    setError(null);
    onClose();
  }

  const working = !!run && isActive(run);
  const finished = !!run && !working;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={finished ? (run.status === "awaiting_review" ? "Your plan is ready" : "No plan this time") : "Plan my weeks"}
      description={
        finished
          ? undefined
          : "We'll suggest drafts in your brand voice. Prices, offers and claims only come from facts you've verified. Nothing is scheduled until you approve it."
      }
      icon={<SparkIcon size={22} />}
      tone="neutral"
      footer={
        working ? (
          <Button variant="outline" onClick={cancel}>Cancel plan</Button>
        ) : finished ? (
          <Button onClick={close}>{run.status === "awaiting_review" ? "Review drafts" : "Close"}</Button>
        ) : (
          <>
            <Button variant="outline" onClick={close}>Not now</Button>
            <Button onClick={start} disabled={busy || !validGoal(input)}>
              {busy ? "Starting…" : "Plan my weeks"}
            </Button>
          </>
        )
      }
    >
      {!run && (
        <div className="flex flex-col gap-4">
          <Textarea
            id="plan-goal"
            label="What should these weeks do for you?"
            hint="For example: sell out the new lip gloss shades before the holidays."
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            limit={500}
          />
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">How long</legend>
            <div role="radiogroup" className="flex gap-2">
              {([2, 4] as const).map((w) => (
                <label
                  key={w}
                  className={`inline-flex min-h-11 cursor-pointer items-center rounded-xl border px-4 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                    weeks === w ? "border-primary bg-primary-soft" : "border-line-strong"
                  }`}
                >
                  <input type="radio" name="plan-weeks" checked={weeks === w} onChange={() => setWeeks(w)} className="sr-only" />
                  {w} weeks
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">Platforms</legend>
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => {
                const on = chosen.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])}
                    className={`press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold ${
                      on ? "border-primary bg-primary-soft text-ink" : "border-line-strong bg-surface text-muted"
                    }`}
                  >
                    <span aria-hidden="true" className="size-2 rounded-full" style={{ background: PLATFORM_META[p.id]?.bg }} />
                    {p.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="m-0 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger-ink">
              {error}
            </p>
          )}
        </div>
      )}

      {working && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <p className="m-0 flex items-center gap-3 text-[15px]">
            <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none" />
            {STEP[run.status] ?? "Working…"}
          </p>
          <p className="m-0 text-sm text-muted">This usually takes under a minute. You can keep this open or cancel.</p>
          {error && <p role="alert" className="m-0 text-sm text-danger-ink">{error}</p>}
        </div>
      )}

      {finished && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {run.status === "awaiting_review" ? (
            <p className="m-0 text-[15px]">
              {run.draftIds.length} draft{run.draftIds.length === 1 ? "" : "s"} added to your calendar, marked{" "}
              <strong>AI draft</strong>. Open one to edit, add a photo and send it for approval.
            </p>
          ) : (
            <p className="m-0 text-[15px]">
              {run.status === "canceled" ? "The plan was canceled. Nothing was saved." : (run.error ?? "The plan didn't finish. Nothing was saved.")}{" "}
              You can still plan posts by hand.
            </p>
          )}
          {run.dropped.length > 0 && (
            <details className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm">
              <summary className="cursor-pointer font-semibold">
                {run.dropped.length} idea{run.dropped.length === 1 ? " was" : "s were"} held back
              </summary>
              <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
                {run.dropped.map((d, i) => (
                  <li key={i}>
                    <span className="font-semibold">{d.idea}</span>{" "}
                    <span className="text-muted">
                      ({d.date}): {d.reason}.
                    </span>
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-2 text-muted">
                Add or verify the fact on your Brand page if you want ideas like these next time.
              </p>
            </details>
          )}
        </div>
      )}
    </Dialog>
  );
}
