"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import {
  activateSupportSession,
  addWorkspaceNote,
  createHold,
  endSupportSession,
  getWorkspace,
  listSupportSessions,
  releaseHold,
  requestSupportSession,
  type StaffMember,
  type SupportSession,
  type WorkspaceDetail,
} from "@/lib/api/client";

const PROVIDER_BADGE: Record<string, { code: string; bg: string }> = {
  ig: { code: "IG", bg: "#D62976" },
  fb: { code: "f", bg: "#1877F2" },
  li: { code: "in", bg: "#0A66C2" },
  tt: { code: "TT", bg: "#111111" },
};

function WorkspaceDetailContent({
  id,
  staff,
}: {
  id: string;
  staff: StaffMember;
}) {
  const router = useRouter();
  const [ws, setWs] = useState<WorkspaceDetail | null>(null);
  const [sessions, setSessions] = useState<SupportSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [holdTarget, setHoldTarget] = useState<{
    scope: "workspace" | "channel";
    channelId?: string;
    label: string;
  } | null>(null);
  const [holdReason, setHoldReason] = useState("");
  const [holdCustomerMsg, setHoldCustomerMsg] = useState(
    "Publishing is temporarily paused by BrandBuild Support. Your approved posts remain saved.",
  );
  const [busyHold, setBusyHold] = useState(false);

  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supMode, setSupMode] = useState<"read_only" | "read_write">("read_only");
  const [supTicket, setSupTicket] = useState("");
  const [supReason, setSupReason] = useState("");
  const [supDuration, setSupDuration] = useState("30");

  const canOperate =
    staff.roles.includes("operations") || staff.roles.includes("staff_admin");

  const load = useCallback(async () => {
    const [res, sRes] = await Promise.all([
      getWorkspace(id),
      listSupportSessions({ workspaceId: id }),
    ]);
    if (res.ok) {
      setWs(res.data);
      setError(null);
    } else {
      setError(res.message);
    }
    if (sRes.ok) setSessions(sRes.data);
  }, [id]);

  useEffect(() => {
    let active = true;
    Promise.all([
      getWorkspace(id),
      listSupportSessions({ workspaceId: id }),
    ]).then(([res, sRes]) => {
      if (!active) return;
      if (res.ok) {
        setWs(res.data);
        setError(null);
      } else {
        setError(res.message);
      }
      if (sRes.ok) setSessions(sRes.data);
    });
    return () => {
      active = false;
    };
  }, [id]);

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSavingNote(true);
    const res = await addWorkspaceNote(id, noteText.trim());
    setSavingNote(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNoteText("");
    await load();
  }

  async function handleCreateHold(e: FormEvent) {
    e.preventDefault();
    if (!holdTarget || !holdReason.trim() || !holdCustomerMsg.trim()) return;
    setBusyHold(true);
    const res = await createHold({
      scope: holdTarget.scope,
      workspaceId: id,
      channelId: holdTarget.channelId,
      internalReason: holdReason.trim(),
      customerMessage: holdCustomerMsg.trim(),
    });
    setBusyHold(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setHoldTarget(null);
    setHoldReason("");
    setActionMsg(`Publishing hold enabled (${holdTarget.label}).`);
    await load();
  }

  async function handleReleaseHold(holdId: string, label: string) {
    setBusyHold(true);
    const res = await releaseHold(holdId, `Released ${label} hold`);
    setBusyHold(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setActionMsg(
      res.data.heldOverduePosts > 0
        ? `Resumed (${label}). ${res.data.heldOverduePosts} overdue post(s) remain held for rescheduling.`
        : `Resumed (${label}).`,
    );
    await load();
  }

  async function handleRequestSupport(e: FormEvent) {
    e.preventDefault();
    if (!supTicket.trim() || !supReason.trim()) return;
    setBusyHold(true);
    const res = await requestSupportSession({
      workspaceId: id,
      mode: supMode,
      ticketRef: supTicket.trim(),
      reason: supReason.trim(),
      durationMinutes: Number(supDuration),
    });
    setBusyHold(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setShowSupportModal(false);
    setSupTicket("");
    setSupReason("");
    setActionMsg(
      res.data.status === "pending_approval"
        ? "Write-enabled support session requested (awaiting Operations/Admin approval)."
        : "Support session ready to activate.",
    );
    await load();
  }

  async function handleActivateSupport(sessionId: string) {
    setBusyHold(true);
    const res = await activateSupportSession(sessionId);
    setBusyHold(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    router.push(`/support/${sessionId}`);
  }

  async function handleEndSupport(sessionId: string) {
    setBusyHold(true);
    const res = await endSupportSession(sessionId);
    setBusyHold(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setActionMsg("Support session ended.");
    await load();
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

  if (!ws) {
    return <div className="h-64 animate-pulse rounded-[18px] bg-surface" />;
  }

  const initial = ws.name.trim()[0]?.toUpperCase() ?? "W";
  const activeHolds = ws.activeHolds ?? [];
  const globalHold = activeHolds.find((h) => h.scope === "global");
  const workspaceHold = activeHolds.find((h) => h.scope === "workspace");

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/workspaces" className="text-muted no-underline fine:hover:underline">
          Workspaces
        </Link>{" "}
        / {ws.name}
      </nav>

      {actionMsg ? (
        <div className="rounded-xl bg-primary-soft px-4 py-2.5 text-sm text-primary-ink">
          {actionMsg}
        </div>
      ) : null}

      {activeHolds.length > 0 ? (
        <div
          role="status"
          className="flex flex-col gap-1.5 rounded-[14px] border border-amber-ink/25 bg-amber-soft px-4 py-3 text-sm text-amber-ink"
        >
          <span className="font-bold">
            Active publishing holds ({activeHolds.length})
          </span>
          {activeHolds.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-amber-ink/15 px-1.5 py-0.5 font-mono text-xs uppercase">
                {h.scope}
              </span>
              <span>{h.internalReason}</span>
              <span className="text-xs opacity-80">
                (Customer: &ldquo;{h.customerMessage}&rdquo;)
              </span>
            </div>
          ))}
          {globalHold && workspaceHold ? (
            <span className="text-xs">
              Note: a global hold is also active — releasing the workspace hold will not resume publishing while the global hold remains active.
            </span>
          ) : null}
        </div>
      ) : null}

      <header className="flex flex-wrap items-center gap-4 rounded-[18px] bg-surface p-5">
        <span className="inline-flex size-[52px] items-center justify-center rounded-2xl bg-forest font-display text-[22px] font-extrabold text-lime">
          {initial}
        </span>
        <div className="flex min-w-[260px] flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 font-display text-[28px] font-bold tracking-tight">
              {ws.name}
            </h1>
            <span className="inline-flex h-6 items-center rounded-md bg-primary-soft px-2 text-xs font-semibold text-primary-ink capitalize">
              {ws.plan}
            </span>
            <span className="inline-flex h-6 items-center rounded-md bg-page-2 px-2 text-xs font-semibold text-ink-2">
              Student check: {ws.studentCheck.status}
            </span>
          </div>
          <span className="text-sm text-muted">
            Owner {ws.owner?.email ?? "—"} · created{" "}
            {new Date(ws.createdAt).toLocaleDateString()} ·{" "}
            <span className="font-mono text-xs">{ws.id}</span>
          </span>
        </div>
        {canOperate ? (
          <div className="flex flex-wrap gap-2">
            {workspaceHold ? (
              <button
                type="button"
                disabled={busyHold}
                onClick={() => handleReleaseHold(workspaceHold.id, "workspace")}
                className="h-9 cursor-pointer rounded-[10px] bg-primary px-3.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Resume publishing
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setHoldTarget({
                    scope: "workspace",
                    label: ws.name,
                  })
                }
                className="h-9 cursor-pointer rounded-[10px] border border-danger-strong bg-danger-soft px-3.5 text-sm font-semibold text-danger-ink"
              >
                Pause publishing
              </button>
            )}
          </div>
        ) : null}
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_600px] flex-col gap-4">
          <section className="overflow-x-auto rounded-[18px] bg-surface p-5">
            <div className="mb-3 flex items-baseline">
              <h2 className="m-0 font-display text-xl font-bold tracking-tight">
                Recent &amp; upcoming posts
              </h2>
              <span className="ml-auto text-sm text-muted">
                {ws.posts.length} shown
              </span>
            </div>
            {ws.posts.length === 0 ? (
              <p className="m-0 text-sm text-muted">No posts yet.</p>
            ) : (
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="text-left text-xs font-semibold tracking-wider text-muted uppercase">
                    <th className="p-2">Post</th>
                    <th className="p-2">Platforms</th>
                    <th className="p-2">When</th>
                    <th className="p-2">State</th>
                  </tr>
                </thead>
                <tbody>
                  {ws.posts.map((p) => (
                    <tr key={p.id} className="border-t border-line text-sm">
                      <td className="p-2 font-semibold">
                        {p.title || "(Untitled post)"}
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {p.platforms.join(", ") || "—"}
                      </td>
                      <td className="p-2 text-ink-2">
                        {p.scheduledFor
                          ? new Date(p.scheduledFor).toLocaleString()
                          : new Date(p.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="p-2">
                        <span className="inline-flex h-6 items-center rounded-md bg-page-2 px-2 text-xs font-semibold text-ink-2">
                          {p.state}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-[18px] bg-surface p-5">
            <h2 className="m-0 font-display text-xl font-bold tracking-tight">
              Internal notes{" "}
              <span className="font-sans text-[13px] font-medium text-muted">
                staff only
              </span>
            </h2>
            {ws.notes.length === 0 ? (
              <p className="m-0 text-sm text-muted">No internal notes yet.</p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {ws.notes.map((n) => (
                  <div key={n.id} className="flex gap-2.5 py-2.5 text-sm">
                    <span className="pt-0.5 font-mono text-xs whitespace-nowrap text-muted">
                      {new Date(n.createdAt).toLocaleDateString()}
                    </span>
                    <span>
                      <strong>{n.staffName}:</strong> {n.note}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={handleAddNote} className="flex gap-2">
              <input
                type="text"
                aria-label="Add internal staff note"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note for other staff"
                className="h-[42px] flex-1 rounded-[10px] border border-line-strong px-3 text-sm"
              />
              <button
                type="submit"
                disabled={savingNote}
                className="h-[42px] cursor-pointer rounded-[10px] border border-border-btn bg-surface px-4 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {savingNote ? "Saving..." : "Add"}
              </button>
            </form>
          </section>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          <section className="flex flex-col gap-2 rounded-[18px] bg-surface p-5">
            <h2 className="m-0 font-display text-xl font-bold tracking-tight">
              Connected accounts
            </h2>
            {ws.channels.length === 0 ? (
              <p className="m-0 text-sm text-muted">No connected accounts.</p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {ws.channels.map((c) => {
                  const badge = PROVIDER_BADGE[c.provider] ?? {
                    code: c.provider.toUpperCase(),
                    bg: "#3D4840",
                  };
                  const channelHold = activeHolds.find(
                    (h) => h.scope === "channel" && h.channelId === c.id,
                  );
                  return (
                    <div
                      key={c.id}
                      className="flex items-center gap-2.5 py-2.5 text-sm"
                    >
                      <span
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] text-[10px] font-bold text-white"
                        style={{ background: badge.bg }}
                      >
                        {badge.code}
                      </span>
                      <span className="flex-1 truncate">
                        {c.displayName ?? c.externalAccountId ?? c.provider}
                      </span>
                      {channelHold ? (
                        <span className="inline-flex h-6 items-center rounded-md bg-danger-soft px-2 text-xs font-semibold text-danger-ink">
                          Held
                        </span>
                      ) : (
                        <span
                          className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold ${
                            c.isActive
                              ? "bg-primary-soft text-primary-ink"
                              : "bg-amber-soft text-amber-ink"
                          }`}
                        >
                          {c.isActive ? "Active" : "Inactive"}
                        </span>
                      )}
                      {canOperate ? (
                        channelHold ? (
                          <button
                            type="button"
                            disabled={busyHold}
                            onClick={() =>
                              handleReleaseHold(
                                channelHold.id,
                                c.displayName ?? c.provider,
                              )
                            }
                            className="h-7 cursor-pointer rounded-md border border-border-btn bg-surface px-2 text-xs font-semibold disabled:opacity-50"
                          >
                            Resume
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setHoldTarget({
                                scope: "channel",
                                channelId: c.id,
                                label:
                                  c.displayName ??
                                  c.externalAccountId ??
                                  c.provider,
                              })
                            }
                            className="h-7 cursor-pointer rounded-md border border-border-btn bg-surface px-2 text-xs font-semibold"
                          >
                            Pause
                          </button>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2 rounded-[18px] bg-surface p-5">
            <h2 className="m-0 font-display text-xl font-bold tracking-tight">
              Team
            </h2>
            <div className="flex flex-col divide-y divide-line">
              {ws.team.map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="truncate">
                    {m.displayName ?? m.email}
                  </span>
                  <span className="text-muted capitalize">{m.role}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-[18px] bg-surface p-5">
            <h2 className="m-0 font-display text-xl font-bold tracking-tight">
              Plan &amp; AI usage
            </h2>
            <div className="flex justify-between py-1.5 text-sm">
              <span className="text-muted">Plan</span>
              <span className="font-semibold capitalize">
                {ws.plan}
                {ws.planEndsAt
                  ? ` · until ${new Date(ws.planEndsAt).toLocaleDateString()}`
                  : ""}
              </span>
            </div>
            <div className="flex justify-between border-t border-line py-1.5 text-sm">
              <span className="text-muted">AI runs this month</span>
              <span className="font-mono">
                {ws.ai.runsThisMonth} / {ws.ai.agentRunsLimit}
              </span>
            </div>
            <div className="flex justify-between border-t border-line py-1.5 text-sm">
              <span className="text-muted">Est. AI spend (month)</span>
              <span className="font-mono">
                ${ws.ai.costUsdThisMonth.toFixed(2)}
              </span>
            </div>
          </section>

          <section className="flex flex-col gap-2.5 rounded-[18px] bg-surface p-5">
            <div className="flex items-center">
              <h2 className="m-0 font-display text-xl font-bold tracking-tight">
                Support access
              </h2>
              <button
                type="button"
                onClick={() => setShowSupportModal(true)}
                className="ml-auto h-8 cursor-pointer rounded-lg border border-border-btn bg-surface px-2.5 text-xs font-semibold"
              >
                Request access
              </button>
            </div>
            {sessions.length === 0 ? (
              <p className="m-0 text-sm text-muted">
                No support sessions for this workspace.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-line">
                {sessions.slice(0, 5).map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center gap-2 py-2 text-xs"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">
                        {s.ticketRef} · {s.mode} ({s.status})
                      </span>
                      <span className="truncate text-muted">
                        {s.requestedByName} · {s.reason}
                      </span>
                    </div>
                    {s.status === "approved" && s.requestedBy === staff.id ? (
                      <button
                        type="button"
                        disabled={busyHold}
                        onClick={() => handleActivateSupport(s.id)}
                        className="h-7 cursor-pointer rounded-md bg-primary px-2.5 text-xs font-semibold text-white"
                      >
                        Activate
                      </button>
                    ) : null}
                    {s.status === "active" && s.requestedBy === staff.id ? (
                      <>
                        <Link
                          href={`/support/${s.id}`}
                          className="inline-flex h-7 items-center rounded-md bg-forest px-2.5 text-xs font-semibold text-white no-underline"
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          disabled={busyHold}
                          onClick={() => handleEndSupport(s.id)}
                          className="h-7 cursor-pointer rounded-md border border-border-btn px-2 text-xs font-semibold"
                        >
                          End
                        </button>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {showSupportModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Request customer support access"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <form
            onSubmit={handleRequestSupport}
            className="flex w-full max-w-md flex-col gap-3 rounded-[18px] bg-surface p-6 shadow-xl"
          >
            <h2 className="m-0 font-display text-xl font-bold">
              Request support access
            </h2>
            <p className="m-0 text-sm text-muted">
              Customer is notified on activation. Write-enabled sessions require approval from another Operations or Staff admin.
            </p>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Access mode
              <select
                value={supMode}
                onChange={(e) =>
                  setSupMode(e.target.value as "read_only" | "read_write")
                }
                className="h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-sm font-normal"
              >
                <option value="read_only">Read-only inspection</option>
                <option value="read_write">Read + Write (requires approval)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Ticket reference
              <input
                type="text"
                required
                value={supTicket}
                onChange={(e) => setSupTicket(e.target.value)}
                placeholder="SUP-1042"
                className="h-10 rounded-[10px] border border-line-strong px-3 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Duration (minutes, 5–60)
              <input
                type="number"
                min="5"
                max="60"
                required
                value={supDuration}
                onChange={(e) => setSupDuration(e.target.value)}
                className="h-10 rounded-[10px] border border-line-strong px-3 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Reason
              <textarea
                rows={2}
                required
                value={supReason}
                onChange={(e) => setSupReason(e.target.value)}
                placeholder="Customer asked for help fixing draft formatting"
                className="rounded-[10px] border border-line-strong p-3 text-sm font-normal"
              />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSupportModal(false)}
                className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-4 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyHold}
                className="h-9 cursor-pointer rounded-[10px] bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busyHold ? "Submitting..." : "Submit request"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {holdTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Pause publishing for ${holdTarget.label}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <form
            onSubmit={handleCreateHold}
            className="flex w-full max-w-lg flex-col gap-3 rounded-[18px] bg-surface p-6 shadow-xl"
          >
            <h2 className="m-0 font-display text-xl font-bold">
              Pause publishing: {holdTarget.label}
            </h2>
            <p className="m-0 text-sm text-muted">
              Stops new publishing claims and re-checks before provider submission. Requests already sent to a provider may still finish. Posts and approvals are preserved.
            </p>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Internal reason
              <input
                type="text"
                required
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="Customer requested pause while updating campaign"
                className="h-10 rounded-[10px] border border-line-strong px-3 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Customer-facing message
              <textarea
                required
                rows={3}
                value={holdCustomerMsg}
                onChange={(e) => setHoldCustomerMsg(e.target.value)}
                className="rounded-[10px] border border-line-strong p-3 text-sm font-normal"
              />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setHoldTarget(null)}
                className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-4 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyHold}
                className="h-9 cursor-pointer rounded-[10px] bg-danger-strong px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busyHold ? "Pausing..." : "Enable hold"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default function WorkspaceDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <AdminShell>
      {(staff) => <WorkspaceDetailContent id={params.id} staff={staff} />}
    </AdminShell>
  );
}
