"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import {
  listUnclearAttempts,
  reconcilePublishAttempt,
  resolvePublishAttempt,
  type StaffMember,
  type UnclearAttempt,
} from "@/lib/api/client";

function UnclearContent({ staff }: { staff: StaffMember }) {
  const [items, setItems] = useState<UnclearAttempt[]>([]);
  const [platform, setPlatform] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canOperate =
    staff.roles.includes("operations") || staff.roles.includes("staff_admin");

  const reload = useCallback(async () => {
    const res = await listUnclearAttempts({
      platform: platform || undefined,
    });
    if (res.ok) {
      setItems(res.data);
      setError(null);
      setSelectedId((prev) => {
        if (prev && res.data.some((i) => i.id === prev)) return prev;
        return res.data[0]?.id ?? null;
      });
    } else {
      setError(res.message);
    }
  }, [platform]);

  useEffect(() => {
    let active = true;
    listUnclearAttempts({ platform: platform || undefined }).then((res) => {
      if (!active) return;
      if (res.ok) {
        setItems(res.data);
        setError(null);
        setSelectedId((prev) => {
          if (prev && res.data.some((i) => i.id === prev)) return prev;
          return res.data[0]?.id ?? null;
        });
      } else {
        setError(res.message);
      }
    });
    return () => {
      active = false;
    };
  }, [platform]);

  const current = items.find((i) => i.id === selectedId) ?? items[0] ?? null;

  async function handleReconcile() {
    if (!current) return;
    setBusy(true);
    const res = await reconcilePublishAttempt(current.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setMsg("Reconciliation check completed.");
    await reload();
  }

  async function handleResolve(
    action: "confirm_published" | "mark_failed" | "retry" | "escalate",
  ) {
    if (!current) return;
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      setError("Enter a resolution note and evidence summary first.");
      return;
    }
    setBusy(true);
    const res = await resolvePublishAttempt(current.id, {
      expectedVersion: current.version,
      idempotencyKey: `${current.id}:v${current.version}:${action}`,
      action,
      note: trimmedNote,
      receipt: receiptId.trim()
        ? { platformPostId: receiptId.trim(), verifiedByStaff: true }
        : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setNote("");
    setReceiptId("");
    setMsg(`Action "${action}" recorded.`);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-[30px] font-bold tracking-tight">
          Unclear publishing outcomes
        </h1>
        <span className="text-sm text-muted">
          Oldest unresolved first · {items.length} item(s)
        </span>
        <select
          aria-label="Filter by platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="ml-auto h-9 rounded-[10px] border border-line-strong bg-surface px-3 text-sm"
        >
          <option value="">All platforms</option>
          <option value="ig">Instagram</option>
          <option value="fb">Facebook</option>
          <option value="li">LinkedIn</option>
          <option value="tt">TikTok</option>
        </select>
      </div>

      {msg ? (
        <div className="rounded-xl bg-primary-soft px-4 py-2.5 text-sm text-primary-ink">
          {msg}
        </div>
      ) : null}

      {!current ? (
        <div className="rounded-[18px] bg-surface p-8 text-center text-sm text-muted">
          No unclear or escalated publishing attempts right now.
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          <aside className="flex w-full flex-col gap-2 rounded-[18px] bg-surface p-3 lg:w-80">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`flex cursor-pointer flex-col gap-0.5 rounded-xl border p-3 text-left ${
                  item.id === current.id
                    ? "border-primary bg-primary-soft/40"
                    : "border-transparent hover:bg-page-2"
                }`}
              >
                <span className="text-sm font-semibold">
                  {item.postTitle || "(Untitled post)"}
                </span>
                <span className="truncate text-xs text-muted">
                  {item.workspaceName} ·{" "}
                  {item.channelProvider ?? item.platforms.join(",")}
                </span>
                <span className="font-mono text-[11px] text-muted">
                  Attempt #{item.attemptNo} ·{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </button>
            ))}
          </aside>

          <section className="flex min-w-0 flex-[2_1_520px] flex-col gap-4 rounded-[18px] bg-surface p-5 text-sm">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="m-0 font-display text-xl font-bold">
                {current.postTitle || "(Untitled post)"}
              </h2>
              <span className="rounded bg-amber-soft px-2 py-0.5 font-mono text-xs font-semibold text-amber-ink">
                {current.state}
                {current.escalated ? " · escalated" : ""}
              </span>
              <Link
                href={`/workspaces/${current.tenantId}`}
                className="ml-auto text-xs font-semibold text-primary-hover no-underline fine:hover:underline"
              >
                Open {current.workspaceName}
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-xl bg-page-2 p-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-muted">
                  Destination account
                </div>
                <div>
                  {current.channelName ?? "—"} (
                  {current.channelProvider ?? current.platforms.join(", ")})
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-muted">
                  Approved version
                </div>
                <div className="font-mono">
                  v{current.approvedVersion} · attempt #{current.attemptNo} (row v
                  {current.version})
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-muted">
                  Worker ownership &amp; fencing
                </div>
                <div className="font-mono text-xs">
                  {current.workerId ?? "unassigned"}
                  {current.fencedAt
                    ? ` · fenced ${new Date(current.fencedAt).toLocaleTimeString()}`
                    : ""}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-muted">
                  Platform post ID
                </div>
                <div className="font-mono text-xs">
                  {current.platformPostId ?? "none"}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs font-semibold text-muted">
                Approved content
              </div>
              <p className="m-0 rounded-xl border border-line p-3 whitespace-pre-wrap">
                {current.approvedContent?.body ?? "(No body)"}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold text-muted">
                  Provider response / receipt
                </div>
                <pre className="m-0 max-h-40 overflow-auto rounded-xl bg-page-2 p-2.5 font-mono text-xs">
                  {JSON.stringify(
                    {
                      error: current.error,
                      receipt: current.receipt,
                      response: current.response,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-muted">
                  Reconciliation evidence
                </div>
                <pre className="m-0 max-h-40 overflow-auto rounded-xl bg-page-2 p-2.5 font-mono text-xs">
                  {JSON.stringify(current.reconcileEvidence ?? {}, null, 2)}
                </pre>
              </div>
            </div>

            {canOperate ? (
              <div className="flex flex-col gap-3 border-t border-line pt-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleReconcile}
                    className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-3.5 text-sm font-semibold disabled:opacity-50"
                  >
                    Check again
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                    Resolution note / evidence (required)
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Verified receipt in IG Business Suite"
                      className="h-9 rounded-[10px] border border-line-strong px-3 text-sm font-normal text-ink"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                    Provider receipt / post ID (for Confirm published)
                    <input
                      type="text"
                      value={receiptId}
                      onChange={(e) => setReceiptId(e.target.value)}
                      placeholder="ig_media_12345"
                      className="h-9 rounded-[10px] border border-line-strong px-3 font-mono text-sm font-normal text-ink"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={
                      busy ||
                      (!current.receipt &&
                        !current.platformPostId &&
                        !receiptId.trim())
                    }
                    onClick={() => handleResolve("confirm_published")}
                    className="h-9 cursor-pointer rounded-[10px] bg-primary px-3.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Confirm published
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleResolve("mark_failed")}
                    className="h-9 cursor-pointer rounded-[10px] border border-danger-strong bg-danger-soft px-3.5 text-sm font-semibold text-danger-ink disabled:opacity-50"
                  >
                    Mark definitively failed
                  </button>
                  <button
                    type="button"
                    disabled={busy || !current.reconcileEvidence?.retryEligible}
                    onClick={() => handleResolve("retry")}
                    className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-3.5 text-sm font-semibold disabled:opacity-50"
                    title={
                      current.reconcileEvidence?.retryEligible
                        ? "Fence previous worker and queue a retry"
                        : "Connector must confirm retry eligibility first"
                    }
                  >
                    Retry (fenced)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleResolve("escalate")}
                    className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-3.5 text-sm font-semibold disabled:opacity-50"
                  >
                    Escalate
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}

export default function AdminUnclearPage() {
  return (
    <AdminShell>{(staff) => <UnclearContent staff={staff} />}</AdminShell>
  );
}
