"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import {
  approveSupportSession,
  createStaff,
  listStaff,
  listSupportSessions,
  ROLE_LABELS,
  updateStaff,
  type StaffMember,
  type StaffRole,
  type SupportSession,
} from "@/lib/api/client";

const ALL_ROLES: StaffRole[] = [
  "support",
  "operations",
  "student_reviewer",
  "staff_admin",
];

function StaffManagement({ currentStaff }: { currentStaff: StaffMember }) {
  const isStaffAdmin = currentStaff.roles.includes("staff_admin");
  const canApproveSupport =
    isStaffAdmin || currentStaff.roles.includes("operations");
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [pendingSessions, setPendingSessions] = useState<SupportSession[]>([]);
  const [loading, setLoading] = useState(isStaffAdmin);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [newRoles, setNewRoles] = useState<StaffRole[]>(["support"]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (isStaffAdmin) {
      const res = await listStaff();
      if (res.ok) {
        setMembers(res.data);
        setError(null);
      } else {
        setError(res.message);
      }
      setLoading(false);
    }
    if (canApproveSupport) {
      const sRes = await listSupportSessions({ status: "pending_approval" });
      if (sRes.ok) setPendingSessions(sRes.data);
    }
  }, [isStaffAdmin, canApproveSupport]);

  useEffect(() => {
    let active = true;
    if (isStaffAdmin) {
      listStaff().then((res) => {
        if (!active) return;
        if (res.ok) {
          setMembers(res.data);
          setError(null);
        } else {
          setError(res.message);
        }
        setLoading(false);
      });
    }
    if (canApproveSupport) {
      listSupportSessions({ status: "pending_approval" }).then((sRes) => {
        if (!active) return;
        if (sRes.ok) setPendingSessions(sRes.data);
      });
    }
    return () => {
      active = false;
    };
  }, [isStaffAdmin, canApproveSupport]);

  async function handleApproveSupport(id: string) {
    const res = await approveSupportSession(id);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await load();
  }

  function toggleNewRole(role: StaffRole) {
    setNewRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !displayName.trim() || newRoles.length === 0) {
      setError("Enter email, display name, and at least one role.");
      return;
    }
    setSubmitting(true);
    const res = await createStaff({
      email: email.trim(),
      displayName: displayName.trim(),
      roles: newRoles,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setEmail("");
    setDisplayName("");
    setNewRoles(["support"]);
    setError(null);
    await load();
  }

  async function toggleMemberRole(member: StaffMember, role: StaffRole) {
    const nextRoles = member.roles.includes(role)
      ? member.roles.filter((r) => r !== role)
      : [...member.roles, role];
    if (nextRoles.length === 0) {
      setError("A staff member must keep at least one role.");
      return;
    }
    const res = await updateStaff(member.id, { roles: nextRoles });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await load();
  }

  async function toggleActive(member: StaffMember) {
    const res = await updateStaff(member.id, {
      isActive: !(member.isActive ?? true),
    });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    await load();
  }

  if (!isStaffAdmin && !canApproveSupport) {
    return (
      <section className="rounded-[18px] bg-surface p-6">
        <h1 className="m-0 font-display text-2xl font-bold tracking-tight">
          Staff &amp; Access
        </h1>
        <p className="mt-2 text-sm text-muted">
          Staff allowlist and role management requires the{" "}
          <strong>Staff admin</strong> role.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[30px] font-bold tracking-tight">
          Staff &amp; Access
        </h1>
        <p className="m-0 text-sm text-muted">
          Manage Google Workspace staff allowlists, roles, and pending write-enabled support session approvals.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink"
        >
          {error}
        </div>
      )}

      {canApproveSupport ? (
        <section className="rounded-[18px] bg-surface p-5">
          <h2 className="m-0 mb-3 font-display text-xl font-bold tracking-tight">
            Pending support session approvals
          </h2>
          {pendingSessions.length === 0 ? (
            <p className="m-0 text-sm text-muted">
              No pending write-enabled support requests.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {pendingSessions.map((s) => {
                const isSelf = s.requestedBy === currentStaff.id;
                return (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center gap-3 py-3 text-sm"
                  >
                    <div className="flex min-w-[240px] flex-1 flex-col gap-0.5">
                      <span className="font-semibold">
                        {s.workspaceName} · {s.ticketRef} ({s.durationMinutes}m{" "}
                        {s.mode})
                      </span>
                      <span className="text-xs text-muted">
                        Requested by {s.requestedByName} ({s.requestedByEmail}) —{" "}
                        {s.reason}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => handleApproveSupport(s.id)}
                      className="h-8 cursor-pointer rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50"
                      title={
                        isSelf
                          ? "You cannot approve your own request"
                          : "Approve write-enabled support session"
                      }
                    >
                      {isSelf ? "Cannot self-approve" : "Approve"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {isStaffAdmin ? (
        <>

      <section className="rounded-[18px] bg-surface p-5">
        <h2 className="m-0 font-display text-xl font-bold tracking-tight">
          Add staff member
        </h2>
        <form
          onSubmit={handleAdd}
          className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3"
        >
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Workspace email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@brandbuild.co"
              className="h-10 rounded-[10px] border border-line-strong px-3 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold">
            Display name
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Full name"
              className="h-10 rounded-[10px] border border-line-strong px-3 font-normal"
            />
          </label>
          <div className="flex flex-col gap-1.5 text-sm font-semibold">
            <span>Roles</span>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ALL_ROLES.map((role) => {
                const on = newRoles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleNewRole(role)}
                    className={`h-8 cursor-pointer rounded-lg px-2.5 text-xs font-semibold ${
                      on
                        ? "bg-forest text-lime"
                        : "border border-line-strong bg-surface text-ink-2"
                    }`}
                  >
                    {ROLE_LABELS[role]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={submitting}
              className="h-10 cursor-pointer rounded-[10px] bg-ink px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submitting ? "Adding..." : "Add to allowlist"}
            </button>
          </div>
        </form>
      </section>

      <section className="overflow-x-auto rounded-[18px] bg-surface p-5">
        <h2 className="m-0 mb-3 font-display text-xl font-bold tracking-tight">
          Allowlisted staff
        </h2>
        {loading ? (
          <p className="text-sm text-muted">Loading staff...</p>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted">No staff members found.</p>
        ) : (
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wider text-muted uppercase">
                <th className="py-2.5 pr-3">Staff</th>
                <th className="py-2.5 pr-3">Status</th>
                <th className="py-2.5 pr-3">Roles</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const active = m.isActive ?? true;
                const isSelf = m.id === currentStaff.id;
                return (
                  <tr key={m.id} className="border-t border-line text-sm">
                    <td className="py-3 pr-3">
                      <div className="font-semibold">{m.displayName}</div>
                      <div className="font-mono text-xs text-muted">
                        {m.email}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold ${
                          active
                            ? "bg-primary-soft text-primary-ink"
                            : "bg-danger-soft text-danger-ink"
                        }`}
                      >
                        {active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap gap-1.5">
                        {ALL_ROLES.map((role) => {
                          const on = m.roles.includes(role);
                          return (
                            <button
                              key={role}
                              type="button"
                              aria-pressed={on}
                              disabled={isSelf && role === "staff_admin"}
                              onClick={() => toggleMemberRole(m, role)}
                              className={`h-7 cursor-pointer rounded-md px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                                on
                                  ? "bg-ink text-white"
                                  : "border border-line-strong bg-surface text-muted"
                              }`}
                            >
                              {ROLE_LABELS[role]}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => toggleActive(m)}
                        className="h-8 cursor-pointer rounded-lg border border-border-btn bg-surface px-3 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {active ? "Disable" : "Re-enable"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
        </>
      ) : null}
    </div>
  );
}

export default function StaffPage() {
  return (
    <AdminShell>
      {(staff) => <StaffManagement currentStaff={staff} />}
    </AdminShell>
  );
}
