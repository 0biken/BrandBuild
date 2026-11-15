"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import {
  decideStudentReview,
  listStudentReviews,
  type StaffMember,
  type StudentReviewItem,
} from "@/lib/api/client";

function ReviewQueueContent({ staff }: { staff: StaffMember }) {
  const [items, setItems] = useState<StudentReviewItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const [nameMatches, setNameMatches] = useState(false);
  const [schoolRecognised, setSchoolRecognised] = useState(false);
  const [expiryFutureDated, setExpiryFutureDated] = useState(false);
  const [genuineCard, setGenuineCard] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const canReview =
    staff.roles.includes("student_reviewer") ||
    staff.roles.includes("staff_admin");

  const resetForm = () => {
    setZoom(1);
    setRotation(0);
    setNameMatches(false);
    setSchoolRecognised(false);
    setExpiryFutureDated(false);
    setGenuineCard(false);
    setRejectionReason("");
  };

  const reload = useCallback(async () => {
    const res = await listStudentReviews(statusFilter);
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
  }, [statusFilter]);

  useEffect(() => {
    let active = true;
    listStudentReviews(statusFilter).then((res) => {
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
  }, [statusFilter]);

  const ordered = [
    ...items.filter((i) => !skippedIds.includes(i.id)),
    ...items.filter((i) => skippedIds.includes(i.id)),
  ];
  const current =
    ordered.find((i) => i.id === selectedId) ?? ordered[0] ?? null;

  async function handleApprove() {
    if (!current) return;
    setBusy(true);
    const res = await decideStudentReview(current.id, {
      expectedVersion: current.version,
      decision: "approved",
      nameMatches,
      schoolRecognised,
      expiryFutureDated,
      genuineCard,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setMsg(
      `Approved ${current.applicantName}. Student plan active until ${
        res.data.planEndsAt
          ? new Date(res.data.planEndsAt).toLocaleDateString()
          : "expiry"
      }.`,
    );
    resetForm();
    await reload();
  }

  async function handleReject(e: FormEvent) {
    e.preventDefault();
    if (!current || !rejectionReason.trim()) return;
    setBusy(true);
    const res = await decideStudentReview(current.id, {
      expectedVersion: current.version,
      decision: "rejected",
      rejectionReason: rejectionReason.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setMsg(`Rejected submission for ${current.applicantName}.`);
    resetForm();
    await reload();
  }

  function handleSkip() {
    if (!current) return;
    setSkippedIds((prev) => [...prev.filter((x) => x !== current.id), current.id]);
    const next = ordered.find((i) => i.id !== current.id);
    if (next) {
      setSelectedId(next.id);
      resetForm();
    }
  }

  if (!canReview) {
    return (
      <div
        role="alert"
        className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink"
      >
        Student reviewer or Staff admin role is required to view student-ID documents.
      </div>
    );
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

  const allChecked =
    nameMatches && schoolRecognised && expiryFutureDated && genuineCard;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-[30px] font-bold tracking-tight">
          Student-ID review queue
        </h1>
        <span className="text-sm text-muted">
          Oldest first · {items.length} item(s)
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter("pending")}
            className={`h-8 cursor-pointer rounded-lg px-3 text-xs font-semibold ${
              statusFilter === "pending"
                ? "bg-forest text-white"
                : "border border-border-btn bg-surface text-ink"
            }`}
          >
            Pending
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`h-8 cursor-pointer rounded-lg px-3 text-xs font-semibold ${
              statusFilter === "all"
                ? "bg-forest text-white"
                : "border border-border-btn bg-surface text-ink"
            }`}
          >
            All history
          </button>
        </div>
      </div>

      {msg ? (
        <div className="rounded-xl bg-primary-soft px-4 py-2.5 text-sm text-primary-ink">
          {msg}
        </div>
      ) : null}

      {!current ? (
        <div className="rounded-[18px] bg-surface p-8 text-center text-sm text-muted">
          No student-ID submissions in this queue.
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          <aside className="flex w-full flex-col gap-2 rounded-[18px] bg-surface p-3 lg:w-72">
            {ordered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.id);
                  resetForm();
                }}
                className={`flex cursor-pointer flex-col gap-0.5 rounded-xl border p-3 text-left ${
                  item.id === current.id
                    ? "border-primary bg-primary-soft/40"
                    : "border-transparent hover:bg-page-2"
                }`}
              >
                <span className="text-sm font-semibold">{item.applicantName}</span>
                <span className="truncate text-xs text-muted">{item.school}</span>
                <span className="font-mono text-[11px] text-muted">
                  {new Date(item.createdAt).toLocaleDateString()} ·{" "}
                  {item.decisionStatus}
                </span>
              </button>
            ))}
          </aside>

          <section className="flex min-w-0 flex-[2_1_480px] flex-col gap-3 rounded-[18px] bg-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{current.applicantName}</span>
              <span className="text-sm text-muted">· {current.school}</span>
              <div className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  className="h-8 cursor-pointer rounded-lg border border-border-btn bg-surface px-2.5 text-xs font-semibold"
                >
                  Zoom −
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                  className="h-8 cursor-pointer rounded-lg border border-border-btn bg-surface px-2.5 text-xs font-semibold"
                >
                  Zoom +
                </button>
                <button
                  type="button"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="h-8 cursor-pointer rounded-lg border border-border-btn bg-surface px-2.5 text-xs font-semibold"
                >
                  Rotate 90°
                </button>
              </div>
            </div>

            <div className="flex min-h-[360px] items-center justify-center overflow-auto rounded-xl border border-line bg-page-2 p-4">
              {current.scanStatus !== "ready" ? (
                <span className="text-sm text-muted">
                  Scan status: {current.scanStatus}
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/admin/v1/student-reviews/${current.id}/preview`}
                  alt={`Student ID for ${current.applicantName}`}
                  className="max-h-[420px] max-w-full rounded object-contain transition-transform"
                  style={{
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  }}
                />
              )}
            </div>
          </section>

          <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-[18px] bg-surface p-5">
            <h2 className="m-0 font-display text-xl font-bold">
              Review decision
            </h2>
            <div className="flex flex-col gap-1 text-sm">
              <div>
                <span className="text-muted">Workspace:</span>{" "}
                <strong>{current.workspaceName}</strong>
              </div>
              <div>
                <span className="text-muted">Owner:</span> {current.ownerEmail}
              </div>
              <div>
                <span className="text-muted">Card expiry:</span>{" "}
                <span className="font-mono">{current.cardExpiryDate}</span>
              </div>
              <div>
                <span className="text-muted">Version:</span>{" "}
                <span className="font-mono">v{current.version}</span>
              </div>
            </div>

            {current.decisionStatus === "pending" ? (
              <>
                <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={nameMatches}
                      onChange={(e) => setNameMatches(e.target.checked)}
                    />
                    Name on card matches applicant
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={schoolRecognised}
                      onChange={(e) => setSchoolRecognised(e.target.checked)}
                    />
                    School is recognised
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={expiryFutureDated}
                      onChange={(e) => setExpiryFutureDated(e.target.checked)}
                    />
                    Expiry is readable &amp; future-dated
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={genuineCard}
                      onChange={(e) => setGenuineCard(e.target.checked)}
                    />
                    Document appears to be a genuine student ID
                  </label>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!allChecked || busy}
                    onClick={handleApprove}
                    className="h-10 flex-1 cursor-pointer rounded-[10px] bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Approve student access
                  </button>
                  <button
                    type="button"
                    onClick={handleSkip}
                    className="h-10 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-3 text-sm font-semibold"
                  >
                    Skip
                  </button>
                </div>

                <form
                  onSubmit={handleReject}
                  className="flex flex-col gap-2 border-t border-line pt-3"
                >
                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                    Rejection reason (sent to owner)
                    <textarea
                      rows={2}
                      required
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Expiry date is obscured or past"
                      className="rounded-[10px] border border-line-strong p-2.5 text-sm font-normal text-ink"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy || !rejectionReason.trim()}
                    className="h-9 cursor-pointer rounded-[10px] border border-danger-strong bg-danger-soft px-4 text-sm font-semibold text-danger-ink disabled:opacity-50"
                  >
                    Reject submission
                  </button>
                </form>
              </>
            ) : (
              <div className="rounded-xl bg-page-2 p-3 text-sm">
                Status: <strong className="capitalize">{current.decisionStatus}</strong>
                {current.rejectionReason ? (
                  <p className="mt-1 mb-0 text-muted">{current.rejectionReason}</p>
                ) : null}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function AdminStudentReviewsPage() {
  return (
    <AdminShell>{(staff) => <ReviewQueueContent staff={staff} />}</AdminShell>
  );
}
