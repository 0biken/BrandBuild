import { newId, read, write, type MockDb } from "@/lib/mock/store";
import { formatShort, scheduleFields } from "@/lib/postDates";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, DraftItem, PlatformId, PostItem, PostState } from "./types";

export type NewPost = Omit<PostItem, "id" | "activityLog">;

/** What the composer submits. The server fills in the display fields. */
export interface PostInput {
  title: string;
  caption: string;
  hashtags: string[];
  platforms: PlatformId[];
  /** ISO timestamp; omitted means post now. */
  scheduledAt?: string;
  /** "approval" when an editor sends for approval. */
  intent: "schedule" | "publish" | "approval";
  aspectRatio?: string;
}

const enc = encodeURIComponent;
const DOT = { green: "#12A150", grey: "#9AA39C", blue: "#2E6FB5" };

/** States whose time can still change. */
const MOVABLE: PostState[] = ["scheduled", "approval", "paused"];

export async function listPosts(): Promise<ApiResult<PostItem[]>> {
  if (API_MODE === "http") return apiFetch<PostItem[]>("/v1/posts");
  return read((d) => d.posts);
}

export async function getPost(id: string): Promise<ApiResult<PostItem>> {
  if (API_MODE === "http") return apiFetch<PostItem>(`/v1/posts/${enc(id)}`);
  const res = await read((d) => d.posts.find((p) => p.id === id) ?? null);
  if (!res.ok) return res;
  return res.data ? { ok: true, data: res.data } : { ok: false, error: "not_found" };
}

function stateFor(intent: PostInput["intent"]): PostState {
  return intent === "approval" ? "approval" : intent === "publish" ? "published" : "scheduled";
}

function logLine(state: PostState, when: Date): string {
  return state === "approval"
    ? "Sent for approval"
    : state === "published"
      ? "Published"
      : `Scheduled for ${formatShort(when)}`;
}

export async function createPost(input: PostInput | NewPost): Promise<ApiResult<PostItem>> {
  if (API_MODE === "http") return apiFetch<PostItem>("/v1/posts", { method: "POST", body: input });
  return write((d) => {
    let post: PostItem;
    if ("intent" in input) {
      const state = stateFor(input.intent);
      const when = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
      post = {
        id: newId("post"),
        title: input.title,
        caption: input.caption,
        hashtags: input.hashtags,
        platforms: input.platforms,
        aspectRatio: input.aspectRatio ?? "1 / 1",
        state,
        ...scheduleFields(when, state),
        activityLog: [
          { text: logLine(state, when), time: formatShort(new Date()), dot: DOT.green },
          { text: "Written by Brandbuild from your idea", time: formatShort(new Date()), dot: DOT.grey },
        ],
      };
    } else {
      post = { ...input, id: newId("post"), activityLog: [] };
    }
    d.posts.unshift(post);
    return post;
  });
}

/** Save edits to an existing post. Editing an approved or scheduled post keeps its state. */
export async function updatePost(id: string, input: PostInput): Promise<ApiResult<PostItem>> {
  if (API_MODE === "http") return apiFetch<PostItem>(`/v1/posts/${enc(id)}`, { method: "PUT", body: input });
  return write((d) => {
    const post = d.posts.find((p) => p.id === id);
    if (!post) return "not_found";
    if (post.state === "published" || post.state === "checking") return "conflict";
    const when = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
    const state = stateFor(input.intent);
    Object.assign(post, {
      title: input.title,
      caption: input.caption,
      hashtags: input.hashtags,
      platforms: input.platforms,
      state,
      ...scheduleFields(when, state),
    });
    post.activityLog.unshift({ text: "Edited", time: formatShort(new Date()), dot: DOT.grey });
    return post;
  });
}

/** Move a post to a new time. Published or unconfirmed posts can't move. */
export async function reschedulePost(id: string, when: Date): Promise<ApiResult<PostItem>> {
  if (API_MODE === "http") {
    return apiFetch<PostItem>(`/v1/posts/${enc(id)}/schedule`, {
      method: "POST",
      body: { scheduledAt: when.toISOString() },
    });
  }
  return write((d) => {
    const post = d.posts.find((p) => p.id === id);
    if (!post) return "not_found";
    if (!MOVABLE.includes(post.state)) return "conflict";
    Object.assign(post, scheduleFields(when, post.state));
    post.activityLog.unshift({
      text: `Moved to ${formatShort(when)}`,
      time: formatShort(new Date()),
      dot: DOT.green,
    });
    return post;
  });
}

/**
 * Move a post to a new state. Retrying a "checking" post is refused with
 * "conflict": the platform check must first confirm no matching post exists
 * (DESIGN.md, outcome unclear), which only staff can resolve.
 */
export async function setPostState(
  id: string,
  state: PostState,
): Promise<ApiResult<PostItem>> {
  if (API_MODE === "http") {
    return apiFetch<PostItem>(`/v1/posts/${enc(id)}/state`, {
      method: "POST",
      body: { state },
    });
  }
  return write((d) => {
    const post = d.posts.find((p) => p.id === id);
    if (!post) return "not_found";
    if (post.state === "checking" && state === "scheduled") return "conflict";
    post.state = state;
    return post;
  });
}

/** Retry a failed post now. Not allowed while the outcome is being checked. */
export async function retryPost(id: string): Promise<ApiResult<PostItem>> {
  if (API_MODE === "http") return apiFetch<PostItem>(`/v1/posts/${enc(id)}/retry`, { method: "POST" });
  return write((d) => {
    const post = d.posts.find((p) => p.id === id);
    if (!post) return "not_found";
    if (post.state !== "failed") return "conflict";
    post.state = "scheduled";
    Object.assign(post, scheduleFields(new Date(Date.now() + 60_000), "scheduled"));
    post.activityLog.unshift({ text: "Retry requested", time: formatShort(new Date()), dot: DOT.green });
    return post;
  });
}

function draftFrom(d: MockDb, post: PostItem, title: string): DraftItem {
  const pfs = post.platforms
    .map((pid) => d.platforms.find((p) => p.id === pid))
    .filter((p) => !!p)
    .map((p) => ({ k: p.k, bg: p.bg }));
  const draft: DraftItem = {
    id: newId("draft"),
    title,
    body: post.caption,
    state: "Ready",
    pfs,
    edited: "Just now",
    action: "Schedule",
  };
  d.drafts.unshift(draft);
  return draft;
}

/** Copy a post into Drafts. */
export async function duplicateToDraft(id: string): Promise<ApiResult<DraftItem>> {
  if (API_MODE === "http") return apiFetch<DraftItem>(`/v1/posts/${enc(id)}/duplicate`, { method: "POST" });
  return write((d) => {
    const post = d.posts.find((p) => p.id === id);
    if (!post) return "not_found";
    return draftFrom(d, post, `${post.title} (copy)`);
  });
}

/** Withdraw an approval request: the post goes back to Drafts. */
export async function withdrawApproval(id: string): Promise<ApiResult<DraftItem>> {
  if (API_MODE === "http") return apiFetch<DraftItem>(`/v1/posts/${enc(id)}/withdraw`, { method: "POST" });
  return write((d) => {
    const i = d.posts.findIndex((p) => p.id === id);
    if (i < 0) return "not_found";
    const post = d.posts[i];
    if (post.state !== "approval") return "conflict";
    d.posts.splice(i, 1);
    return draftFrom(d, post, post.title);
  });
}

export async function deletePost(id: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch(`/v1/posts/${enc(id)}`, { method: "DELETE" });
  return write((d) => {
    const i = d.posts.findIndex((p) => p.id === id);
    if (i < 0) return "not_found";
    d.posts.splice(i, 1);
    return undefined;
  });
}
