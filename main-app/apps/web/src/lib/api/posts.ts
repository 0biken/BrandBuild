import { newId, read, write } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, PostItem, PostState } from "./types";

export type NewPost = Omit<PostItem, "id" | "activityLog">;

export async function listPosts(): Promise<ApiResult<PostItem[]>> {
  if (API_MODE === "http") return apiFetch<PostItem[]>("/v1/posts");
  return read((d) => d.posts);
}

export async function getPost(id: string): Promise<ApiResult<PostItem>> {
  if (API_MODE === "http") return apiFetch<PostItem>(`/v1/posts/${encodeURIComponent(id)}`);
  const res = await read((d) => d.posts.find((p) => p.id === id) ?? null);
  if (!res.ok) return res;
  return res.data ? { ok: true, data: res.data } : { ok: false, error: "not_found" };
}

export async function createPost(input: NewPost): Promise<ApiResult<PostItem>> {
  if (API_MODE === "http") return apiFetch<PostItem>("/v1/posts", { method: "POST", body: input });
  return write((d) => {
    const post: PostItem = { ...input, id: newId("post"), activityLog: [] };
    d.posts.unshift(post);
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
    return apiFetch<PostItem>(`/v1/posts/${encodeURIComponent(id)}/state`, {
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

export async function deletePost(id: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch(`/v1/posts/${encodeURIComponent(id)}`, { method: "DELETE" });
  return write((d) => {
    const i = d.posts.findIndex((p) => p.id === id);
    if (i < 0) return "not_found";
    d.posts.splice(i, 1);
    return undefined;
  });
}
