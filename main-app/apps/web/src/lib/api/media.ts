import { deleteBlob, putBlob } from "@/lib/media/store";
import { newId, read, write } from "@/lib/mock/store";
import { API_MODE, API_URL } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, MediaRef } from "./types";

/**
 * Media library. In mock mode files are kept in the browser (IndexedDB) and
 * only their metadata goes in the mock store. In http mode files upload to
 * the API as multipart form data.
 */

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
/** Most a post can carry (Instagram carousels allow 10). */
export const MAX_MEDIA_PER_POST = 10;

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** Checks a file before import; returns a message for the user, or null. */
export function mediaProblem(file: Pick<File, "name" | "type" | "size">): string | null {
  if (IMAGE_TYPES.includes(file.type)) {
    return file.size > IMAGE_MAX_BYTES ? `${file.name} is over ${mb(IMAGE_MAX_BYTES)}. Try a smaller photo.` : null;
  }
  if (VIDEO_TYPES.includes(file.type)) {
    return file.size > VIDEO_MAX_BYTES ? `${file.name} is over ${mb(VIDEO_MAX_BYTES)}. Try a shorter clip.` : null;
  }
  return `${file.name} isn't a supported photo or video. Use JPG, PNG, WebP, GIF, MP4, MOV or WebM.`;
}

function videoDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const v = document.createElement("video");
      const url = URL.createObjectURL(file);
      const done = (d?: number) => {
        URL.revokeObjectURL(url);
        resolve(d);
      };
      v.preload = "metadata";
      v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? Math.round(v.duration) : undefined);
      v.onerror = () => done(undefined);
      setTimeout(() => done(undefined), 4000);
      v.src = url;
    } catch {
      resolve(undefined);
    }
  });
}

export async function listMedia(): Promise<ApiResult<MediaRef[]>> {
  if (API_MODE === "http") return apiFetch<MediaRef[]>("/v1/media");
  return read((d) => d.media);
}

export async function addMedia(file: File): Promise<ApiResult<MediaRef>> {
  if (mediaProblem(file)) return { ok: false, error: "invalid" };
  if (API_MODE === "http") {
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch(`${API_URL}/v1/media`, { method: "POST", body, credentials: "include" });
      return res.ok ? { ok: true, data: (await res.json()) as MediaRef } : { ok: false, error: "invalid" };
    } catch {
      return { ok: false, error: "network" };
    }
  }
  const kind = file.type.startsWith("video/") ? "video" : "image";
  const ref: MediaRef = {
    id: newId("media"),
    name: file.name,
    kind,
    type: file.type,
    size: file.size,
    duration: kind === "video" ? await videoDuration(file) : undefined,
    addedAt: new Date().toISOString(),
  };
  await putBlob(ref.id, file);
  return write((d) => {
    d.media.unshift(ref);
    return ref;
  });
}

export async function removeMedia(id: string): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch(`/v1/media/${encodeURIComponent(id)}`, { method: "DELETE" });
  await deleteBlob(id);
  return write((d) => {
    d.media = d.media.filter((m) => m.id !== id);
    return undefined;
  });
}

/** "0:42" for a video length. */
export function formatDuration(sec: number | undefined): string {
  if (sec === undefined) return "";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
