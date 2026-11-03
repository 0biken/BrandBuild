import { read, write } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, AppNotification } from "./types";

/** Newest first. */
export async function listNotifications(): Promise<ApiResult<AppNotification[]>> {
  if (API_MODE === "http") return apiFetch<AppNotification[]>("/v1/notifications");
  return read((d) => d.notifications);
}

export async function markNotificationRead(id: string): Promise<ApiResult<AppNotification>> {
  if (API_MODE === "http") return apiFetch<AppNotification>(`/v1/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
  return write((d) => {
    const n = d.notifications.find((x) => x.id === id);
    if (!n) return "not_found";
    n.read = true;
    return n;
  });
}

export async function markAllNotificationsRead(): Promise<ApiResult> {
  if (API_MODE === "http") return apiFetch("/v1/notifications/read-all", { method: "POST" });
  return write((d) => {
    d.notifications.forEach((n) => (n.read = true));
    return undefined;
  });
}
