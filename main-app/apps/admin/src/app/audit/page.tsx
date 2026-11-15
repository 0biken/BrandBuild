"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { listAudit, type StaffAuditRow } from "@/lib/api/client";

function AuditView() {
  const [rows, setRows] = useState<StaffAuditRow[]>([]);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listAudit({ action: actionFilter || undefined, limit: 100 }).then((res) => {
      if (!active) return;
      if (res.ok) {
        setRows(res.data);
        setError(null);
      } else {
        setError(res.message);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [actionFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[30px] font-bold tracking-tight">
            Audit log
          </h1>
          <p className="m-0 mt-1 text-sm text-muted">
            Every staff action and support session. Entries are append-only and
            retained for 12 months.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-9 rounded-[10px] border border-line-strong bg-surface px-3 text-sm"
          >
            <option value="">All actions</option>
            <option value="staff_login">Staff login</option>
            <option value="staff_logout">Staff logout</option>
            <option value="staff_created">Staff created</option>
            <option value="staff_updated">Staff updated</option>
            <option value="publishing_hold.create">Publishing hold</option>
            <option value="publishing_hold.release">Hold released</option>
            <option value="publish_attempt.retry">Publish retry</option>
            <option value="student_review.approve">Student approved</option>
            <option value="support_session.activate">Support activated</option>
            <option value="audit.export">Audit export</option>
          </select>
          <a
            href={`/api/admin/v1/audit/export${
              actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : ""
            }`}
            className="inline-flex h-9 items-center rounded-[10px] border border-border-btn bg-surface px-3.5 text-sm font-semibold text-ink no-underline"
          >
            Export CSV
          </a>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink"
        >
          {error}
        </div>
      )}

      <section className="overflow-x-auto rounded-[18px] bg-surface p-4">
        {loading ? (
          <p className="p-2 text-sm text-muted">Loading audit events...</p>
        ) : rows.length === 0 ? (
          <p className="p-2 text-sm text-muted">No audit events recorded yet.</p>
        ) : (
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wider text-muted uppercase">
                <th className="p-2.5">When</th>
                <th className="p-2.5">Who</th>
                <th className="p-2.5">Action</th>
                <th className="p-2.5">Target</th>
                <th className="p-2.5">Outcome</th>
                <th className="p-2.5">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line text-sm">
                  <td className="p-2.5 font-mono text-xs whitespace-nowrap text-ink-2">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="p-2.5 font-semibold whitespace-nowrap">
                    {r.staffEmail ?? "—"}
                  </td>
                  <td className="p-2.5 font-mono text-xs">{r.action}</td>
                  <td className="p-2.5 font-mono text-xs text-muted">
                    {r.targetType ? `${r.targetType}:${r.targetId ?? ""}` : "—"}
                  </td>
                  <td className="p-2.5">
                    <span
                      className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold ${
                        r.outcome === "success"
                          ? "bg-primary-soft text-primary-ink"
                          : "bg-danger-soft text-danger-ink"
                      }`}
                    >
                      {r.outcome}
                    </span>
                  </td>
                  <td className="p-2.5 text-ink-2">{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default function AuditPage() {
  return <AdminShell>{() => <AuditView />}</AdminShell>;
}
