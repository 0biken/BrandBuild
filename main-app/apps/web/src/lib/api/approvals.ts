import { read, write, type MockDb } from "@/lib/mock/store";
import { formatShort, isPast, postDate, postTimestamp, scheduleFields } from "@/lib/postDates";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import { draftFrom } from "./posts";
import type { ApiResult, PostItem } from "./types";

/**
 * Owner/reviewer decisions on posts sent for approval (DESIGN: Approvals).
 * Unapproved posts wait; they never auto-post. Every decision can be undone.
 */

export type Decision = "approve" | "changes" | "reject";

/** What a decision changed, so Undo can put it back. */
export interface DecisionReceipt {
  decision: Decision;
  postId: string;
  /** The post as it was while waiting. */
  before: PostItem;
  /** Its position in the posts list. */
  index: number;
  /** Approve: the post as now scheduled. */
  post?: PostItem;
  /** Changes or reject: the draft the post became. */
  draftId?: string;
}

const enc = encodeURIComponent;
const DOT_GREEN = "#12A150";

/** Editors send posts for approval; only owners and reviewers decide. */
const canDecide = (d: MockDb) => d.session.role !== "editor";

/** Posts waiting for approval, soonest to go out first. */
export async function listApprovals(): Promise<ApiResult<PostItem[]>> {
  if (API_MODE === "http") return apiFetch<PostItem[]>("/v1/approvals");
  return read((d) =>
    d.posts.filter((p) => p.state === "approval").sort((a, b) => postTimestamp(a) - postTimestamp(b)),
  );
}

function waiting(d: MockDb, id: string) {
  if (!canDecide(d)) return "forbidden" as const;
  const index = d.posts.findIndex((p) => p.id === id);
  if (index < 0) return "not_found" as const;
  const post = d.posts[index];
  if (post.state !== "approval") return "conflict" as const;
  return { index, post, before: structuredClone(post) };
}

/** Approve: the post is scheduled for its time, or a minute from now if that has passed. */
export async function approvePost(id: string): Promise<ApiResult<DecisionReceipt>> {
  if (API_MODE === "http") return apiFetch<DecisionReceipt>(`/v1/posts/${enc(id)}/approve`, { method: "POST" });
  return write((d) => {
    const w = waiting(d, id);
    if (typeof w === "string") return w;
    const { index, post, before } = w;
    const due = postDate(post);
    const when = isPast(due) ? new Date(Date.now() + 60_000) : due;
    Object.assign(post, { state: "scheduled", ...scheduleFields(when, "scheduled") });
    delete post.reviewer;
    delete post.requestedBy;
    delete post.requestedAt;
    post.activityLog.unshift({ text: `Approved by ${d.session.name}`, time: formatShort(new Date()), dot: DOT_GREEN });
    return { decision: "approve" as const, postId: id, before, index, post: structuredClone(post) };
  });
}

/** Send it back with a note. The post moves to Drafts, carrying the note. */
export async function requestChanges(id: string, note: string): Promise<ApiResult<DecisionReceipt>> {
  if (API_MODE === "http") {
    return apiFetch<DecisionReceipt>(`/v1/posts/${enc(id)}/request-changes`, { method: "POST", body: { note } });
  }
  return write((d) => {
    if (!note.trim()) return "invalid";
    return toDraft(d, id, "changes", note.trim());
  });
}

/** Reject: the post won't go out and moves back to Drafts. */
export async function rejectPost(id: string): Promise<ApiResult<DecisionReceipt>> {
  if (API_MODE === "http") return apiFetch<DecisionReceipt>(`/v1/posts/${enc(id)}/reject`, { method: "POST" });
  return write((d) => toDraft(d, id, "reject"));
}

function toDraft(d: MockDb, id: string, decision: "changes" | "reject", note?: string) {
  const w = waiting(d, id);
  if (typeof w === "string") return w;
  d.posts.splice(w.index, 1);
  const draft = draftFrom(d, w.post, w.post.title);
  if (note) Object.assign(draft, { feedback: note, action: "Make changes" });
  return { decision, postId: id, before: w.before, index: w.index, draftId: draft.id };
}

/** Undo a decision: the post is waiting for approval again, as it was. */
export async function undoDecision(r: DecisionReceipt): Promise<ApiResult<PostItem>> {
  if (API_MODE === "http") {
    return apiFetch<PostItem>(`/v1/posts/${enc(r.postId)}/undo-decision`, { method: "POST" });
  }
  return write((d) => {
    if (!canDecide(d)) return "forbidden";
    if (r.decision === "approve") {
      const i = d.posts.findIndex((p) => p.id === r.postId);
      if (i < 0 || d.posts[i].state !== "scheduled") return "conflict";
      d.posts[i] = structuredClone(r.before);
      return d.posts[i];
    }
    const di = d.drafts.findIndex((x) => x.id === r.draftId);
    if (di < 0 || d.posts.some((p) => p.id === r.postId)) return "conflict";
    d.drafts.splice(di, 1);
    const post = structuredClone(r.before);
    d.posts.splice(Math.min(r.index, d.posts.length), 0, post);
    return post;
  });
}
