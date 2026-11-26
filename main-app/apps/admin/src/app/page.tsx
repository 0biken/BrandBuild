"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import {
  createHold,
  createIncident,
  getOverview,
  listHolds,
  releaseHold,
  updateIncident,
  type OverviewSummary,
  type PublishingHold,
  type StaffMember,
} from "@/lib/api/client";

const PLATFORM_META: Record<
  string,
  { code: string; name: string; bg: string }
> = {
  ig: { code: "IG", name: "Instagram", bg: "#D62976" },
  fb: { code: "f", name: "Facebook", bg: "#1877F2" },
  li: { code: "in", name: "LinkedIn", bg: "#0A66C2" },
  tt: { code: "TT", name: "TikTok", bg: "#111111" },
};

function formatAge(minutes: number | null): string {
  if (minutes === null || Number.isNaN(minutes)) return "No waiting items";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `Oldest ${rounded}m`;
  const hrs = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return `Oldest ${hrs}h ${mins}m`;
}

function OverviewContent({ staff }: { staff: StaffMember }) {
  const [data, setData] = useState<OverviewSummary | null>(null);
  const [globalHold, setGlobalHold] = useState<PublishingHold | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [incTitle, setIncTitle] = useState("");
  const [incPlatforms, setIncPlatforms] = useState<string[]>(["ig"]);
  const [incMessage, setIncMessage] = useState("");
  const [incPublishBanner, setIncPublishBanner] = useState(true);

  const [showPauseModal, setShowPauseModal] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [pauseCustomerMsg, setPauseCustomerMsg] = useState(
    "Publishing is temporarily paused while we resolve a platform issue. Approved posts will remain scheduled.",
  );

  const canOperate =
    staff.roles.includes("operations") || staff.roles.includes("staff_admin");

  const reload = useCallback(async () => {
    const [ovRes, holdsRes] = await Promise.all([getOverview(), listHolds()]);
    if (ovRes.ok) {
      setData(ovRes.data);
      setError(null);
    } else {
      setError(ovRes.message);
    }
    if (holdsRes.ok) {
      setGlobalHold(holdsRes.data.find((h) => h.scope === "global") ?? null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getOverview(), listHolds()]).then(([ovRes, holdsRes]) => {
      if (!active) return;
      if (ovRes.ok) {
        setData(ovRes.data);
        setError(null);
      } else {
        setError(ovRes.message);
      }
      if (holdsRes.ok) {
        setGlobalHold(holdsRes.data.find((h) => h.scope === "global") ?? null);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleCreateIncident(e: FormEvent) {
    e.preventDefault();
    if (!incTitle.trim() || !incMessage.trim() || incPlatforms.length === 0) return;
    setBusy(true);
    const res = await createIncident({
      title: incTitle.trim(),
      platforms: incPlatforms,
      customerMessage: incMessage.trim(),
      publishBanner: incPublishBanner,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setShowIncidentModal(false);
    setIncTitle("");
    setIncMessage("");
    setActionMsg("Incident recorded.");
    await reload();
  }

  async function handleToggleBanner(id: string, publishBanner: boolean) {
    setBusy(true);
    const res = await updateIncident(id, { publishBanner });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await reload();
  }

  async function handleResolveIncident(id: string) {
    setBusy(true);
    const res = await updateIncident(id, { resolve: true });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setActionMsg("Incident resolved.");
    await reload();
  }

  async function handleGlobalPause(e: FormEvent) {
    e.preventDefault();
    if (!pauseReason.trim() || !pauseCustomerMsg.trim()) return;
    setBusy(true);
    const res = await createHold({
      scope: "global",
      internalReason: pauseReason.trim(),
      customerMessage: pauseCustomerMsg.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setShowPauseModal(false);
    setPauseReason("");
    setActionMsg("Global publishing hold enabled.");
    await reload();
  }

  async function handleGlobalResume() {
    if (!globalHold) return;
    setBusy(true);
    const res = await releaseHold(globalHold.id, "Global resume from overview");
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setActionMsg(
      res.data.heldOverduePosts > 0
        ? `Global publishing resumed. ${res.data.heldOverduePosts} overdue post(s) remain held for rescheduling.`
        : "Global publishing resumed.",
    );
    await reload();
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink"
      >
        {error}
      </div>
    );
  }

  if (!data) {
    return <div className="h-48 animate-pulse rounded-[18px] bg-surface" />;
  }

  const failPct =
    data.failedToday.total > 0
      ? `${((data.failedToday.failed / data.failedToday.total) * 100).toFixed(1)}% of ${data.failedToday.total} today (UTC)`
      : "No publish attempts today (UTC)";

  const activeIncidents = data.activeIncidents ?? [];

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-[30px] font-bold tracking-tight">
          Needs a person
        </h1>
        <span className="text-sm text-muted">
          Updated {new Date(data.generatedAt).toLocaleString()}
        </span>
        {canOperate ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowIncidentModal(true)}
              className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-3.5 text-sm font-semibold text-ink"
            >
              Report incident
            </button>
            {data.pausedWorkspaces.globalPaused && globalHold ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleGlobalResume}
                className="h-9 cursor-pointer rounded-[10px] bg-primary px-3.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Resume global publishing
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowPauseModal(true)}
                className="h-9 cursor-pointer rounded-[10px] border border-danger-strong bg-danger-soft px-3.5 text-sm font-semibold text-danger-ink"
              >
                Pause all publishing
              </button>
            )}
          </div>
        ) : null}
      </div>

      {actionMsg ? (
        <div className="rounded-xl bg-primary-soft px-4 py-2.5 text-sm text-primary-ink">
          {actionMsg}
        </div>
      ) : null}

      {data.pausedWorkspaces.globalPaused && globalHold ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-[14px] border border-danger-strong/30 bg-danger-soft px-4 py-3 text-sm text-danger-ink"
        >
          <span className="font-bold">Global publishing hold active:</span>
          <span className="flex-1">
            {globalHold.internalReason} (Customer banner: &ldquo;{globalHold.customerMessage}&rdquo;)
          </span>
        </div>
      ) : null}

      {activeIncidents.map((inc) => (
        <div
          key={inc.id}
          className="flex flex-wrap items-center gap-3 rounded-[14px] border border-amber-ink/25 bg-amber-soft px-4 py-3 text-sm text-amber-ink"
        >
          <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <span>{inc.title}</span>
              <span className="font-mono text-xs uppercase">
                [{inc.platforms.join(", ")}]
              </span>
              {inc.publishBanner ? (
                <span className="rounded bg-amber-ink/15 px-1.5 py-0.5 text-[11px] font-bold">
                  Customer banner ON
                </span>
              ) : (
                <span className="rounded bg-page-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
                  Staff only
                </span>
              )}
            </div>
            <span>{inc.customerMessage}</span>
          </div>
          {canOperate ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleToggleBanner(inc.id, !inc.publishBanner)}
                className="h-8 cursor-pointer rounded-lg border border-border-btn bg-surface px-2.5 text-xs font-semibold text-ink disabled:opacity-50"
              >
                {inc.publishBanner ? "Hide banner" : "Show banner"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleResolveIncident(inc.id)}
                className="h-8 cursor-pointer rounded-lg bg-ink px-2.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Resolve
              </button>
            </div>
          ) : null}
        </div>
      ))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/unclear"
          className="flex flex-col gap-1.5 rounded-[18px] bg-forest p-[18px] text-forest-text no-underline transition-transform fine:hover:-translate-y-0.5"
        >
          <span className="text-[13px] font-semibold text-lime">
            Outcome unclear
          </span>
          <span className="font-display text-[44px] leading-none font-bold text-white">
            {data.unclear.count}
          </span>
          <span className="text-sm text-forest-ink">
            {formatAge(data.unclear.oldestMinutes)}
          </span>
        </Link>

        <Link
          href="/student-reviews"
          className="flex flex-col gap-1.5 rounded-[18px] bg-surface p-[18px] text-ink no-underline transition-transform fine:hover:-translate-y-0.5"
        >
          <span className="text-[13px] font-semibold text-muted">
            Student reviews
          </span>
          <span className="font-display text-[44px] leading-none font-bold">
            {data.studentReviews.count}
          </span>
          <span className="text-sm text-amber-ink">
            {formatAge(data.studentReviews.oldestMinutes)}
          </span>
        </Link>

        <Link
          href="/workspaces"
          className="flex flex-col gap-1.5 rounded-[18px] bg-surface p-[18px] text-ink no-underline transition-transform fine:hover:-translate-y-0.5"
        >
          <span className="text-[13px] font-semibold text-muted">
            Paused workspaces
          </span>
          <span className="font-display text-[44px] leading-none font-bold">
            {data.pausedWorkspaces.count}
          </span>
          <span className="text-sm text-muted">
            Global &amp; workspace holds
          </span>
        </Link>

        <Link
          href="/workspaces"
          className="flex flex-col gap-1.5 rounded-[18px] bg-surface p-[18px] text-ink no-underline transition-transform fine:hover:-translate-y-0.5"
        >
          <span className="text-[13px] font-semibold text-muted">
            Failed publishes today
          </span>
          <span className="font-display text-[44px] leading-none font-bold">
            {data.failedToday.failed}
          </span>
          <span className="text-sm text-muted">{failPct}</span>
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[2_1_640px] overflow-x-auto rounded-[18px] bg-surface p-5">
          <div className="mb-3 flex items-baseline gap-2.5">
            <h2 className="m-0 font-display text-xl font-bold tracking-tight">
              Publishing today
            </h2>
            <span className="text-sm text-muted">by platform · UTC day</span>
          </div>
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wider text-muted uppercase">
                <th className="py-2.5 pr-2.5">Platform</th>
                <th className="py-2.5 pr-2.5">Provider health</th>
                <th className="py-2.5 pr-2.5 text-right">Verified</th>
                <th className="py-2.5 pr-2.5 text-right">Accepted</th>
                <th className="py-2.5 pr-2.5 text-right">Failed</th>
                <th className="py-2.5 pr-2.5 text-right">Unclear</th>
                <th className="py-2.5 text-right">Success</th>
              </tr>
            </thead>
            <tbody>
              {data.platforms.map((p) => {
                const meta = PLATFORM_META[p.platform] ?? {
                  code: p.platform.toUpperCase(),
                  name: p.platform,
                  bg: "#3D4840",
                };
                const total =
                  p.verified + p.acceptedUnverified + p.failed + p.unclear;
                const successText =
                  total === 0
                    ? "No data"
                    : `${((p.verified / total) * 100).toFixed(1)}% (${p.verified}/${total})`;
                return (
                  <tr key={p.platform} className="border-t border-line text-sm">
                    <td className="py-2.5 pr-2.5">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-flex size-[22px] items-center justify-center rounded-md text-[9px] font-bold text-white"
                          style={{ background: meta.bg }}
                        >
                          {meta.code}
                        </span>
                        {meta.name}
                      </span>
                    </td>
                    <td className="py-2.5 pr-2.5">
                      {activeIncidents.some((inc) =>
                        inc.platforms.includes(p.platform),
                      ) ? (
                        <span className="inline-flex h-6 items-center rounded-md bg-amber-soft px-2 text-xs font-semibold text-amber-ink">
                          Staff incident
                        </span>
                      ) : (
                        <span className="inline-flex h-6 items-center rounded-md bg-page-2 px-2 text-xs font-semibold text-ink-2">
                          Unknown
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-2.5 text-right font-mono">
                      {p.verified}
                    </td>
                    <td className="py-2.5 pr-2.5 text-right font-mono">
                      {p.acceptedUnverified}
                    </td>
                    <td
                      className={`py-2.5 pr-2.5 text-right font-mono ${
                        p.failed > 0 ? "text-danger-strong" : ""
                      }`}
                    >
                      {p.failed}
                    </td>
                    <td className="py-2.5 pr-2.5 text-right font-mono">
                      {p.unclear}
                    </td>
                    <td className="py-2.5 text-right font-mono font-semibold">
                      {successText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
          <Link
            href="/ai-spend"
            className="flex flex-col gap-3 rounded-[18px] bg-surface p-5 text-ink no-underline transition-transform fine:hover:-translate-y-0.5"
          >
            <div className="flex items-baseline">
              <h2 className="m-0 font-display text-xl font-bold tracking-tight">
                AI spend today
              </h2>
              <span className="ml-auto text-sm font-semibold text-primary-hover">
                Details
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold">
                ${data.aiToday.costUsd.toFixed(2)}
              </span>
              <span className="text-sm text-muted">est. · UTC day</span>
            </div>
            <span className="text-[13px] text-muted">
              {data.aiToday.runs === 0
                ? "No AI runs recorded today"
                : `${data.aiToday.runs} runs${
                    data.aiToday.topWorkspace
                      ? ` · top: ${data.aiToday.topWorkspace.name} ($${data.aiToday.topWorkspace.costUsd.toFixed(2)})`
                      : ""
                  }`}
            </span>
          </Link>

          <section className="flex flex-col gap-3 rounded-[18px] bg-surface p-5">
            <div className="flex items-baseline">
              <h2 className="m-0 font-display text-xl font-bold tracking-tight">
                Recent staff actions
              </h2>
              <Link
                href="/audit"
                className="ml-auto text-sm font-semibold no-underline"
              >
                Audit log
              </Link>
            </div>
            {data.recentActions.length === 0 ? (
              <p className="m-0 text-sm text-muted">No staff actions yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-sm">
                {data.recentActions.map((a) => (
                  <li key={a.id} className="flex gap-2.5">
                    <span className="pt-0.5 font-mono text-xs text-muted">
                      {new Date(a.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span>
                      <strong>{a.staffName}</strong> ·{" "}
                      <span className="font-mono text-xs">{a.action}</span>
                      {a.reason ? ` (${a.reason})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      {showIncidentModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Report provider incident"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <form
            onSubmit={handleCreateIncident}
            className="flex w-full max-w-lg flex-col gap-3 rounded-[18px] bg-surface p-6 shadow-xl"
          >
            <h2 className="m-0 font-display text-xl font-bold">
              Report provider incident
            </h2>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Incident title
              <input
                type="text"
                required
                value={incTitle}
                onChange={(e) => setIncTitle(e.target.value)}
                placeholder="Instagram Reels publish failures"
                className="h-10 rounded-[10px] border border-line-strong px-3 text-sm font-normal"
              />
            </label>
            <fieldset className="flex flex-wrap gap-3 border-0 p-0 text-sm">
              <legend className="mb-1 text-sm font-semibold">
                Affected platforms
              </legend>
              {(["ig", "fb", "li", "tt"] as const).map((plat) => (
                <label key={plat} className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={incPlatforms.includes(plat)}
                    onChange={(e) =>
                      setIncPlatforms((prev) =>
                        e.target.checked
                          ? [...prev, plat]
                          : prev.filter((x) => x !== plat),
                      )
                    }
                  />
                  {PLATFORM_META[plat]?.name ?? plat}
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Customer message
              <textarea
                required
                rows={3}
                value={incMessage}
                onChange={(e) => setIncMessage(e.target.value)}
                placeholder="Publishing to Instagram is currently degraded. Your scheduled posts remain safe."
                className="rounded-[10px] border border-line-strong p-3 text-sm font-normal"
              />
            </label>
            {incMessage.trim() ? (
              <div className="rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber-ink">
                <strong>Customer preview:</strong> {incMessage.trim()}
              </div>
            ) : null}
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={incPublishBanner}
                onChange={(e) => setIncPublishBanner(e.target.checked)}
              />
              Publish customer banner immediately
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowIncidentModal(false)}
                className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-4 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-9 cursor-pointer rounded-[10px] bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving..." : "Save incident"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {showPauseModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pause all publishing"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <form
            onSubmit={handleGlobalPause}
            className="flex w-full max-w-lg flex-col gap-3 rounded-[18px] bg-surface p-6 shadow-xl"
          >
            <h2 className="m-0 font-display text-xl font-bold">
              Pause all publishing
            </h2>
            <p className="m-0 text-sm text-muted">
              Stops new publishing claims across all workspaces and re-checks before provider submission. Requests already sent to a provider may still finish.
            </p>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Internal reason
              <input
                type="text"
                required
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                placeholder="Incident #42: global rate-limit spike"
                className="h-10 rounded-[10px] border border-line-strong px-3 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Customer-facing message
              <textarea
                required
                rows={3}
                value={pauseCustomerMsg}
                onChange={(e) => setPauseCustomerMsg(e.target.value)}
                className="rounded-[10px] border border-line-strong p-3 text-sm font-normal"
              />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPauseModal(false)}
                className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-4 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-9 cursor-pointer rounded-[10px] bg-danger-strong px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Pausing..." : "Enable global hold"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminOverviewPage() {
  return (
    <AdminShell showSearch>
      {(staff) => <OverviewContent staff={staff} />}
    </AdminShell>
  );
}
