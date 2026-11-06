import { read, write } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, NotificationPrefs } from "./types";

export async function getNotificationPrefs(): Promise<ApiResult<NotificationPrefs>> {
  if (API_MODE === "http") return apiFetch<NotificationPrefs>("/v1/settings/notifications");
  return read((d) => d.notificationPrefs);
}

export async function updateNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<ApiResult<NotificationPrefs>> {
  if (API_MODE === "http") {
    return apiFetch<NotificationPrefs>("/v1/settings/notifications", { method: "PATCH", body: patch });
  }
  return write((d) => Object.assign(d.notificationPrefs, patch));
}
