import { newId, read, write, type MockDb } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { AgentRun, ApiResult, DraftItem, PlanGoal, PlatformId } from "./types";

/**
 * AI plans. Starting one returns at once; the plan runs on the server and is
 * followed with getRun until it settles. A plan only ever saves drafts: nothing
 * it writes is approved or scheduled until a person does that.
 */

const enc = encodeURIComponent;

/** A run is still working while it's in one of these states. */
export const RUN_ACTIVE = ["queued", "context_loading", "planning", "generating", "validating"] as const;
export const isActive = (run: AgentRun) => (RUN_ACTIVE as readonly string[]).includes(run.status);

export function validGoal(g: PlanGoal) {
  return (
    g.goal.trim().length > 0 &&
    g.goal.length <= 500 &&
    (g.weeks === 2 || g.weeks === 4) &&
    g.platforms.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(g.startDate)
  );
}

export async function createPlan(goal: PlanGoal): Promise<ApiResult<{ runId: string }>> {
  if (API_MODE === "http") return apiFetch<{ runId: string }>("/v1/plans", { method: "POST", body: goal });
  if (!validGoal(goal)) return { ok: false, error: "invalid" };
  return write((d) => {
    const run: MockRun = { id: newId("run"), goal, startedAt: Date.now() };
    runs(d).push(run);
    return { runId: run.id };
  });
}

export async function getRun(id: string): Promise<ApiResult<AgentRun>> {
  if (API_MODE === "http") return apiFetch<AgentRun>(`/v1/agent-runs/${enc(id)}`);
  return write((d) => {
    const run = runs(d).find((r) => r.id === id);
    if (!run) return "not_found";
    advance(d, run);
    return toRun(run);
  });
}

export async function cancelRun(id: string): Promise<ApiResult<AgentRun>> {
  if (API_MODE === "http") return apiFetch<AgentRun>(`/v1/agent-runs/${enc(id)}/cancel`, { method: "POST" });
  return write((d) => {
    const run = runs(d).find((r) => r.id === id);
    if (!run) return "not_found";
    advance(d, run);
    if (run.result) return "conflict";
    run.result = { status: "canceled", draftIds: [], dropped: [] };
    return toRun(run);
  });
}

// ---------- mock ----------

interface MockRun {
  id: string;
  goal: PlanGoal;
  startedAt: number;
  result?: Pick<AgentRun, "status" | "draftIds" | "dropped">;
}

type WithRuns = MockDb & { runs?: MockRun[] };
const runs = (d: MockDb) => ((d as WithRuns).runs ??= []);

/** The mock "thinks" for a few seconds, then saves its drafts in one go. */
const MOCK_RUN_MS = 3000;

const PF: Record<PlatformId, { k: string; bg: string }> = {
  ig: { k: "IG", bg: "#D62976" },
  fb: { k: "f", bg: "#1877F2" },
  li: { k: "in", bg: "#0A66C2" },
  tt: { k: "TT", bg: "#111111" },
};

const IDEAS = [
  { pillar: "product", title: "Meet this week's favourite", body: "A closer look at the shade everyone keeps asking about, and why it lasts all day." },
  { pillar: "tips", title: "How to pick your shade", body: "Three quick checks in good light so the shade you buy is the one you wanted." },
  { pillar: "behind", title: "Packing day", body: "Every order is packed by hand. Here's what goes into the box before it reaches you." },
  { pillar: "community", title: "Your looks", body: "We loved seeing how you wear it. Tag us and you might be next week's feature." },
  { pillar: "story", title: "Why we started", body: "It began with one shade we couldn't find anywhere. Here's how that turned into this." },
  { pillar: "tips", title: "Make it last", body: "Two small steps before you apply that keep colour on through a long day." },
];

function advance(d: MockDb, run: MockRun) {
  if (run.result || Date.now() - run.startedAt < MOCK_RUN_MS) return;
  const start = new Date(`${run.goal.startDate}T00:00:00`);
  const days = [0, 2, 4];
  const made: DraftItem[] = [];
  for (let week = 0; week < run.goal.weeks; week++) {
    days.forEach((offset, i) => {
      const idea = IDEAS[(week * days.length + i) % IDEAS.length];
      const at = new Date(start);
      at.setDate(at.getDate() + week * 7 + offset);
      at.setHours(18, 0, 0, 0);
      made.push({
        id: newId("draft"),
        title: idea.title,
        body: idea.body,
        state: "Needs a photo",
        pfs: run.goal.platforms.map((p) => PF[p]),
        edited: "Just now",
        action: "Add photo",
        scheduledAt: at.toISOString(),
        source: {
          kind: "ai_plan",
          runId: run.id,
          model: "mock",
          factIds: [],
          pillar: idea.pillar,
          reasoning: `Fits "${run.goal.goal}" and keeps the week varied.`,
          warnings: [],
          localTime: "18:00",
        },
      });
    });
  }
  d.drafts.unshift(...made);
  const extra = new Date(start);
  extra.setDate(extra.getDate() + 1);
  run.result = {
    status: "awaiting_review",
    draftIds: made.map((m) => m.id),
    dropped: [
      {
        platform: run.goal.platforms[0],
        date: extra.toISOString().slice(0, 10),
        idea: "Flash sale announcement",
        reason: "states 30% without a verified fact behind it",
      },
    ],
  };
}

function toRun(run: MockRun): AgentRun {
  const r = run.result;
  return {
    id: run.id,
    kind: "plan",
    status: r?.status ?? "planning",
    draftIds: r?.draftIds ?? [],
    dropped: r?.dropped ?? [],
    warnings: [],
    ...(r?.status === "canceled" ? { error: "Canceled." } : {}),
    createdAt: new Date(run.startedAt).toISOString(),
    ...(r ? { finishedAt: new Date().toISOString() } : {}),
  };
}

/** Read-only helper for tests. */
export const _mockRuns = () => read((d) => runs(d).length);
