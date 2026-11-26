"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { searchWorkspaces, type WorkspaceListItem } from "@/lib/api/client";

const PAGE_SIZE = 25;

function WorkspacesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qParam = searchParams.get("q") ?? "";
  const planParam = searchParams.get("plan") ?? "";
  const pageParam = Math.max(0, Number(searchParams.get("page") ?? "0") || 0);

  const [queryInput, setQueryInput] = useState(qParam);
  const [items, setItems] = useState<WorkspaceListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    searchWorkspaces({
      q: qParam || undefined,
      plan: planParam || undefined,
      limit: PAGE_SIZE,
      offset: pageParam * PAGE_SIZE,
    }).then((res) => {
      if (!active) return;
      if (res.ok) {
        setItems(res.data.items);
        setTotal(res.data.total);
        setError(null);
      } else {
        setError(res.message);
      }
    });
    return () => {
      active = false;
    };
  }, [qParam, planParam, pageParam]);

  function pushParams(next: { q?: string; plan?: string; page?: number }) {
    const sp = new URLSearchParams();
    const q = next.q !== undefined ? next.q : qParam;
    const plan = next.plan !== undefined ? next.plan : planParam;
    const page = next.page !== undefined ? next.page : pageParam;
    if (q) sp.set("q", q);
    if (plan) sp.set("plan", plan);
    if (page > 0) sp.set("page", String(page));
    const qs = sp.toString();
    router.push(`/workspaces${qs ? `?${qs}` : ""}`);
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    pushParams({ q: queryInput.trim(), page: 0 });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-[30px] font-bold tracking-tight">
            Workspaces
          </h1>
          <p className="m-0 mt-1 text-sm text-muted">
            Search by workspace name, owner email, workspace ID, or exact post
            ID.
          </p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="Search workspaces"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Workspace, owner email, workspace ID, or post ID"
          className="h-10 min-w-[260px] flex-1 rounded-[10px] border border-line-strong bg-surface px-3 text-sm"
        />
        <select
          aria-label="Filter by plan"
          value={planParam}
          onChange={(e) => pushParams({ plan: e.target.value, page: 0 })}
          className="h-10 rounded-[10px] border border-line-strong bg-surface px-3 text-sm"
        >
          <option value="">All plans</option>
          <option value="student">Student</option>
          <option value="creator">Creator</option>
          <option value="business">Business</option>
        </select>
        <button
          type="submit"
          className="h-10 cursor-pointer rounded-[10px] bg-ink px-4 text-sm font-semibold text-white"
        >
          Search
        </button>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-ink"
        >
          {error}
        </div>
      )}

      <section className="overflow-x-auto rounded-[18px] bg-surface p-4">
        {items === null ? (
          <p className="p-2 text-sm text-muted">Loading workspaces...</p>
        ) : items.length === 0 ? (
          <p className="p-2 text-sm text-muted">
            No workspaces match your search.
          </p>
        ) : (
          <table className="w-full min-w-[780px] border-collapse">
            <thead>
              <tr className="text-left text-xs font-semibold tracking-wider text-muted uppercase">
                <th className="p-2.5">Workspace</th>
                <th className="p-2.5">Owner</th>
                <th className="p-2.5">Plan</th>
                <th className="p-2.5 text-right">Channels</th>
                <th className="p-2.5 text-right">Unclear</th>
                <th className="p-2.5 text-right">Failed (7d)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ws) => (
                <tr key={ws.id} className="border-t border-line text-sm">
                  <td className="p-2.5">
                    <Link
                      href={`/workspaces/${ws.id}`}
                      className="font-semibold text-ink no-underline fine:hover:underline"
                    >
                      {ws.name}
                    </Link>
                    <div className="font-mono text-xs text-muted">{ws.id}</div>
                  </td>
                  <td className="p-2.5 text-ink-2">
                    {ws.ownerEmail ?? "—"}
                  </td>
                  <td className="p-2.5 capitalize">{ws.plan}</td>
                  <td className="p-2.5 text-right font-mono">
                    {ws.activeChannels}
                  </td>
                  <td className="p-2.5 text-right font-mono">
                    {ws.unclearPosts}
                  </td>
                  <td className="p-2.5 text-right font-mono">
                    {ws.failedPosts7d}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm text-muted">
          <span>
            {total} workspace{total === 1 ? "" : "s"} · page {pageParam + 1} of{" "}
            {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pageParam === 0}
              onClick={() => pushParams({ page: pageParam - 1 })}
              className="h-8 cursor-pointer rounded-lg border border-border-btn bg-surface px-3 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={pageParam + 1 >= totalPages}
              onClick={() => pushParams({ page: pageParam + 1 })}
              className="h-8 cursor-pointer rounded-lg border border-border-btn bg-surface px-3 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function WorkspacesPage() {
  return (
    <AdminShell>
      {() => (
        <Suspense
          fallback={<div className="h-48 animate-pulse rounded-[18px] bg-surface" />}
        >
          <WorkspacesContent />
        </Suspense>
      )}
    </AdminShell>
  );
}
