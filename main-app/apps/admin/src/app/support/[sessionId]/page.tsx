"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AdminShell } from "@/components/AdminShell";
import {
  editSupportDraft,
  endSupportSession,
  getSupportWorkspace,
  type SupportWorkspaceView,
} from "@/lib/api/client";

function SupportWorkspaceContent({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [view, setView] = useState<SupportWorkspaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [remainingSec, setRemainingSec] = useState<number>(0);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await getSupportWorkspace(sessionId);
    if (res.ok) {
      setView(res.data);
      setError(null);
    } else {
      setError(res.message);
    }
  }, [sessionId]);

  useEffect(() => {
    let active = true;
    getSupportWorkspace(sessionId).then((res) => {
      if (!active) return;
      if (res.ok) {
        setView(res.data);
        setError(null);
      } else {
        setError(res.message);
      }
    });
    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!view) return;
    const expMs = new Date(view.session.expiresAt).getTime();
    const tick = () => {
      setRemainingSec(Math.max(0, Math.floor((expMs - Date.now()) / 1000)));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [view]);

  async function handleEnd() {
    await endSupportSession(sessionId);
    if (view) {
      router.replace(`/workspaces/${view.workspace.id}`);
    } else {
      router.replace("/workspaces");
    }
  }

  async function handleSaveDraft(e: FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    const res = await editSupportDraft(sessionId, editingId, {
      title: editTitle,
      body: editBody,
      reason: editReason.trim() || undefined,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setEditingId(null);
    setMsg(`Draft updated (v${res.data.version}) as BrandBuild Support.`);
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

  if (!view) {
    return <div className="h-64 animate-pulse rounded-[18px] bg-surface" />;
  }

  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 rounded-[14px] bg-forest px-4 py-3 text-sm text-white"
      >
        <span className="rounded bg-lime px-2 py-0.5 text-xs font-bold text-forest uppercase">
          {view.session.mode === "read_write" ? "Read + Write" : "Read-only"} support session
        </span>
        <span className="font-semibold">
          {view.workspace.name} · Ticket {view.session.ticketRef}
        </span>
        <span className="font-mono text-xs text-forest-ink">
          Expires in {String(mins).padStart(2, "0")}:
          {String(secs).padStart(2, "0")}
        </span>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/workspaces/${view.workspace.id}`}
            className="inline-flex h-8 items-center rounded-lg border border-white/25 px-3 text-xs font-semibold text-white no-underline"
          >
            Back to workspace
          </Link>
          <button
            type="button"
            onClick={handleEnd}
            className="h-8 cursor-pointer rounded-lg bg-danger-strong px-3 text-xs font-semibold text-white"
          >
            End session
          </button>
        </div>
      </div>

      {msg ? (
        <div className="rounded-xl bg-primary-soft px-4 py-2.5 text-sm text-primary-ink">
          {msg}
        </div>
      ) : null}

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-[2_1_560px] rounded-[18px] bg-surface p-5">
          <h2 className="m-0 mb-3 font-display text-xl font-bold">
            Drafts &amp; posts ({view.drafts.length})
          </h2>
          {view.drafts.length === 0 ? (
            <p className="m-0 text-sm text-muted">No drafts or posts yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {view.drafts.map((d) => (
                <div key={d.id} className="flex flex-col gap-1.5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {d.title || "(Untitled)"}
                    </span>
                    <span className="rounded bg-page-2 px-2 py-0.5 text-xs font-semibold">
                      {d.state}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {d.platforms.join(", ")}
                    </span>
                    {view.session.mode === "read_write" &&
                    (d.state === "draft" || d.state === "idea") ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(d.id);
                          setEditTitle(d.title);
                          setEditBody(d.body);
                          setEditReason("");
                        }}
                        className="ml-auto h-7 cursor-pointer rounded-md border border-border-btn bg-surface px-2.5 text-xs font-semibold"
                      >
                        Edit draft
                      </button>
                    ) : null}
                  </div>
                  <p className="m-0 whitespace-pre-wrap text-ink-2">
                    {d.body || "(Empty body)"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <section className="rounded-[18px] bg-surface p-5 text-sm">
            <h2 className="m-0 mb-2 font-display text-xl font-bold">
              Brand profile
            </h2>
            {view.brand ? (
              <dl className="m-0 flex flex-col gap-2">
                <div>
                  <dt className="text-xs font-semibold text-muted">Tone</dt>
                  <dd className="m-0">{view.brand.tone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">Audience</dt>
                  <dd className="m-0">{view.brand.audience ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-muted">Offerings</dt>
                  <dd className="m-0">{view.brand.offerings ?? "—"}</dd>
                </div>
              </dl>
            ) : (
              <p className="m-0 text-muted">No brand profile yet.</p>
            )}
          </section>

          <section className="rounded-[18px] bg-surface p-5 text-sm">
            <h2 className="m-0 mb-2 font-display text-xl font-bold">
              Brand facts ({view.facts.length})
            </h2>
            {view.facts.length === 0 ? (
              <p className="m-0 text-muted">No brand facts yet.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {view.facts.map((f) => (
                  <li key={f.id} className="border-t border-line pt-2">
                    <div className="font-semibold">
                      {f.label} ({f.kind})
                    </div>
                    <div className="text-muted">{f.value}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {editingId ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit draft in support session"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
        >
          <form
            onSubmit={handleSaveDraft}
            className="flex w-full max-w-lg flex-col gap-3 rounded-[18px] bg-surface p-6 shadow-xl"
          >
            <h2 className="m-0 font-display text-xl font-bold">
              Edit draft (attributed to BrandBuild Support)
            </h2>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Title
              <input
                type="text"
                required
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="h-10 rounded-[10px] border border-line-strong px-3 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Body
              <textarea
                rows={4}
                required
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                className="rounded-[10px] border border-line-strong p-3 text-sm font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Audit reason
              <input
                type="text"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Fixed broken link per customer request"
                className="h-10 rounded-[10px] border border-line-strong px-3 text-sm font-normal"
              />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="h-9 cursor-pointer rounded-[10px] border border-border-btn bg-surface px-4 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-9 cursor-pointer rounded-[10px] bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save draft"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export default function SupportWorkspacePage() {
  const params = useParams<{ sessionId: string }>();
  return (
    <AdminShell>
      {() => <SupportWorkspaceContent sessionId={params.sessionId} />}
    </AdminShell>
  );
}
