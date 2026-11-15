"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import {
  getAiSpend,
  updateAiPolicy,
  updateWorkspaceAi,
  type AiSpendSummary,
  type StaffMember,
} from "@/lib/api/client";

function AiSpendContent({ staff }: { staff: StaffMember }) {
  const [data, setData] = useState<AiSpendSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [globalCap, setGlobalCap] = useState("");
  const [wsMonthCap, setWsMonthCap] = useState("");
  const [wsDailyGen, setWsDailyGen] = useState("");
  const [policyReason, setPolicyReason] = useState("");

  const [suspendTarget, setSuspendTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [suspendHours, setSuspendHours] = useState("24");
  const [suspendReason, setSuspendReason] = useState("");

  const canOperate =
    staff.roles.includes("operations") || staff.roles.includes("staff_admin");

  const syncPolicyInputs = (s: AiSpendSummary) => {
    setGlobalCap(String(s.policy.globalDailyUsdBudget));
    setWsMonthCap(String(s.policy.defaultWorkspaceMonthlyUsdBudget));
    setWsDailyGen(String(s.policy.defaultWorkspaceDailyGenLimit));
  };

  const reload = useCallback(async () => {
    const res = await getAiSpend(14);
    if (res.ok) {
      setData(res.data);
      syncPolicyInputs(res.data);
      setError(null);
    } else {
      setError(res.message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getAiSpend(14).then((res) => {
      if (!active) return;
      if (res.ok) {
        setData(res.data);
        syncPolicyInputs(res.data);
        setError(null);
      } else {
        setError(res.message);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSavePolicy(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await updateAiPolicy({
      globalDailyUsdBudget: Number(globalCap),
      defaultWorkspaceMonthlyUsdBudget: Number(wsMonthCap),
      defaultWorkspaceDailyGenLimit: Number(wsDailyGen),
      reason: policyReason.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setPolicyReason("");
    setMsg("Global AI policy updated.");
    await reload();
  }

  async function handleSuspendWorkspace(e: FormEvent) {
    e.preventDefault();
    if (!suspendTarget) return;
    setBusy(true);
    const res = await updateWorkspaceAi(suspendTarget.id, {
      suspendHours: Number(suspendHours),
      reason: suspendReason.trim() || "Temporary AI suspension by operations",
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setSuspendTarget(null);
    setSuspendReason("");
    setMsg(`AI suspended for ${suspendTarget.name}.`);
    await reload();
  }

  async function handleClearSuspension(id: string, name: string) {
    setBusy(true);
    const res = await updateWorkspaceAi(id, {
      clearSuspension: true,
      reason: "Cleared AI suspension",
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setMsg(`AI resumed for ${name}.`);
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
    return <div className="h-64 animate-pulse rounded-[18px] bg-surface" />;
  }

  const globalPct =
    data.policy.globalDailyUsdBudget > 0
      ? Math.round((data.today.costUsd / data.policy.globalDailyUsdBudget) * 100)
      : 0;
  const maxDaily = Math.max(
    data.policy.globalDailyUsdBudget,
    ...data.daily.map((d) => d.costUsd),
    1,
  );
  const featureTotal = Math.max(
    data.byFeature.reduce((acc, f) => acc + f.costUsd, 0),
    0.0001,
  );

  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="m-0 font-display text-[30px] font-bold tracking-tight">
          AI spend &amp; guardrails
        </h1>
        <span className="text-sm text-muted">
          UTC accounting · estimates · updated{" "}
          {new Date(data.generatedAt).toLocaleString()}
        </span>
      </div>

      {msg ? (
        <div className="rounded-xl bg-primary-soft px-4 py-2.5 text-sm text-primary-ink">
          {msg}
        </div>
      ) : null}

      {globalPct >= data.policy.alertWarnPct ? (
        <div
          role="alert"
          className={`rounded-[14px] px-4 py-3 text-sm font-semibold ${
            globalPct >= data.policy.alertHardPct
              ? "bg-danger-soft text-danger-ink"
              : "bg-amber-soft text-amber-ink"
          }`}
        >
          Global daily AI budget is at {globalPct}% ($
          {data.today.costUsd.toFixed(2)} / $
          {data.policy.globalDailyUsdBudget.toFixed(2)} est. UTC today).
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5 rounded-[18px] bg-surface p-[18px]">
          <span className="text-[13px] font-semibold text-muted">
            Today (est. UTC)
          </span>
          <span className="font-display text-[40px] leading-none font-bold">
            ${data.today.costUsd.toFixed(2)}
          </span>
          <span className="text-sm text-muted">
            {globalPct}% of ${data.policy.globalDailyUsdBudget.toFixed(2)} daily cap
          </span>
        </div>

        <div className="flex flex-col gap-1.5 rounded-[18px] bg-surface p-[18px]">
          <span className="text-[13px] font-semibold text-muted">
            Month to date (est.)
          </span>
          <span className="font-display text-[40px] leading-none font-bold">
            ${data.month.costUsd.toFixed(2)}
          </span>
          <span className="text-sm text-muted">{data.month.runs} runs</span>
        </div>

        <div className="flex flex-col gap-1.5 rounded-[18px] bg-surface p-[18px]">
          <span className="text-[13px] font-semibold text-muted">
            Runs today (UTC)
          </span>
          <span className="font-display text-[40px] leading-none font-bold">
            {data.today.runs}
          </span>
          <span className="text-sm text-muted">
            ${data.today.reservedUsd.toFixed(2)} currently reserved
          </span>
        </div>

        <div className="flex flex-col gap-1.5 rounded-[18px] bg-surface p-[18px]">
          <span className="text-[13px] font-semibold text-muted">
            Failed but billed
          </span>
          <span className="font-display text-[40px] leading-none font-bold">
            {data.today.failedButBilledRuns}
          </span>
          <span className="text-sm text-amber-ink">
            ${data.today.uncertainUsd.toFixed(2)} uncertain timeouts kept reserved
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[2_1_600px] rounded-[18px] bg-surface p-5">
          <div className="mb-4 flex items-baseline">
            <h2 className="m-0 font-display text-xl font-bold tracking-tight">
              Daily spend (last 14 UTC days)
            </h2>
            <span className="ml-auto text-xs text-muted">
              Cap ${data.policy.globalDailyUsdBudget.toFixed(2)}/day
            </span>
          </div>
          <div className="flex h-40 items-end gap-2">
            {data.daily.map((d) => {
              const pct = Math.min(100, Math.round((d.costUsd / maxDaily) * 100));
              return (
                <div
                  key={d.day}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${d.day}: $${d.costUsd.toFixed(2)} (${d.runs} runs)`}
                >
                  <div className="flex h-28 w-full items-end rounded-md bg-page-2 p-0.5">
                    <div
                      className="w-full rounded bg-primary transition-all"
                      style={{ height: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-muted">
                    {d.day.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-[18px] bg-surface p-5">
          <h2 className="m-0 font-display text-xl font-bold tracking-tight">
            By feature (month)
          </h2>
          {data.byFeature.length === 0 ? (
            <p className="m-0 text-sm text-muted">No AI runs this month.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.byFeature.map((f) => {
                const pct = Math.round((f.costUsd / featureTotal) * 100);
                return (
                  <div key={f.feature} className="flex flex-col gap-1 text-sm">
                    <div className="flex justify-between">
                      <span className="font-semibold capitalize">
                        {f.feature}
                      </span>
                      <span className="font-mono text-xs text-muted">
                        ${f.costUsd.toFixed(2)} · {f.runs} runs
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-page-2">
                      <div
                        className="h-full rounded-full bg-forest"
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[2_1_640px] overflow-x-auto rounded-[18px] bg-surface p-5">
          <h2 className="m-0 mb-3 font-display text-xl font-bold tracking-tight">
            Top workspaces (UTC month)
          </h2>
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wider text-muted uppercase">
                <th className="py-2 pr-2.5">Workspace</th>
                <th className="py-2 pr-2.5 text-right">Runs</th>
                <th className="py-2 pr-2.5 text-right">Est. spend</th>
                <th className="py-2 pr-2.5 text-right">Monthly cap</th>
                <th className="py-2 pr-2.5">Status</th>
                {canOperate ? <th className="py-2 text-right">Control</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.topWorkspaces.map((w) => {
                const suspended =
                  w.suspendedUntil && new Date(w.suspendedUntil) > new Date();
                return (
                  <tr key={w.id} className="border-t border-line text-sm">
                    <td className="py-2.5 pr-2.5 font-semibold">
                      <Link
                        href={`/workspaces/${w.id}`}
                        className="text-ink no-underline fine:hover:underline"
                      >
                        {w.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-2.5 text-right font-mono">
                      {w.runs}
                    </td>
                    <td className="py-2.5 pr-2.5 text-right font-mono">
                      ${w.costUsd.toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-2.5 text-right font-mono">
                      ${w.monthlyBudgetUsd.toFixed(2)}
                    </td>
                    <td className="py-2.5 pr-2.5">
                      {suspended ? (
                        <span className="inline-flex h-6 items-center rounded-md bg-danger-soft px-2 text-xs font-semibold text-danger-ink">
                          Suspended
                        </span>
                      ) : (
                        <span className="inline-flex h-6 items-center rounded-md bg-primary-soft px-2 text-xs font-semibold text-primary-ink">
                          Active
                        </span>
                      )}
                    </td>
                    {canOperate ? (
                      <td className="py-2.5 text-right">
                        {suspended ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleClearSuspension(w.id, w.name)}
                            className="h-7 cursor-pointer rounded-md border border-border-btn bg-surface px-2.5 text-xs font-semibold"
                          >
                            Resume AI
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setSuspendTarget({ id: w.id, name: w.name })
                            }
                            className="h-7 cursor-pointer rounded-md border border-danger-strong bg-danger-soft px-2.5 text-xs font-semibold text-danger-ink"
                          >
                            Suspend AI
                          </button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {canOperate ? (
          <section className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-[18px] bg-surface p-5">
            <h2 className="m-0 font-display text-xl font-bold tracking-tight">
              Guardrail caps
            </h2>
            <form onSubmit={handleSavePolicy} className="flex flex-col gap-2.5">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Global daily USD budget
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  required
                  value={globalCap}
                  onChange={(e) => setGlobalCap(e.target.value)}
                  className="h-9 rounded-[10px] border border-line-strong px-3 font-mono text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Default workspace monthly USD cap
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  required
                  value={wsMonthCap}
                  onChange={(e) => setWsMonthCap(e.target.value)}
                  className="h-9 rounded-[10px] border border-line-strong px-3 font-mono text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Default workspace daily generation limit
                <input
                  type="number"
                  step="1"
                  min="0"
                  required
                  value={wsDailyGen}
                  onChange={(e) => setWsDailyGen(e.target.value)}
                  className="h-9 rounded-[10px] border border-line-strong px-3 font-mono text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Audit reason
                <input
                  type="text"
                  value={policyReason}
                  onChange={(e) => setPolicyReason(e.target.value)}
                  placeholder="Optional reason for cap change"
                  className="h-9 rounded-[10px] border border-line-strong px-3 text-sm text-ink"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="mt-1 h-9 cursor-pointer rounded-[10px] bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Saving..." : "Save caps"}
              </button>
            </form>
          </section>
        ) : null}
      </div>

      {suspendTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Suspend AI for ${suspendTarget.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <form
            onSubmit={handleSuspendWorkspace}
            className="flex w-full max-w-md flex-col gap-3 rounded-[18px] bg-surface p-6 shadow-xl"
          >
            <h2 className="m-0 font-display text-xl font-bold">
              Suspend AI: {suspendTarget.name}
            </h2>
            <p className="m-0 text-sm text-muted">
              Blocks new AI plan and generation calls without deleting existing drafts.
            </p>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Duration (hours)
              <input
                type="number"
                min="1"
                max="720"
                required
                value={suspendHours}
                onChange={(e) => setSuspendHours(e.target.value)}
                className="h-10 rounded-[10px] border border-line-strong px-3 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Reason
              <input
                type="text"
                required
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="Excessive retry loop"
                className="h-10 rounded-[10px] border border-line-strong px-3 text-sm font-normal"
              />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSuspendTarget(null)}
                className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-4 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="h-9 cursor-pointer rounded-[10px] bg-danger-strong px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Suspending..." : "Suspend AI"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminAiSpendPage() {
  return <AdminShell>{(staff) => <AiSpendContent staff={staff} />}</AdminShell>;
}
