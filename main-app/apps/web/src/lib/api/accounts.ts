import { mockConfig, newId, read, write } from "@/lib/mock/store";
import { API_MODE, API_URL } from "./config";
import { apiFetch } from "./http";
import type { AccountPlatform, ApiResult, ConnectedAccount, PlatformConfig } from "./types";

export async function listAccounts(): Promise<ApiResult<ConnectedAccount[]>> {
  if (API_MODE === "http") return apiFetch<ConnectedAccount[]>("/v1/accounts");
  return read((d) => d.accounts);
}

/** Platforms with per-platform limits and connection hints, for the composer. */
export async function listPlatforms(): Promise<ApiResult<PlatformConfig[]>> {
  if (API_MODE === "http") return apiFetch<PlatformConfig[]>("/v1/platforms");
  return read((d) => d.platforms);
}

/** Display details for each connectable platform (Connect design). */
export const CONNECTABLE: { id: AccountPlatform; name: string; badge: string; bg: string; blurb: string }[] = [
  { id: "ig", name: "Instagram", badge: "IG", bg: "#D62976", blurb: "Business or Creator account" },
  { id: "li", name: "LinkedIn", badge: "in", bg: "#0A66C2", blurb: "Personal profile or company page" },
  { id: "tt", name: "TikTok", badge: "TT", bg: "#111111", blurb: "Videos and photo posts" },
  { id: "fb", name: "Facebook", badge: "f", bg: "#1877F2", blurb: "Pages you manage" },
  { id: "yt", name: "YouTube", badge: "YT", bg: "#E6002E", blurb: "Shorts and community posts" },
];

const SAMPLE_HANDLES: Record<AccountPlatform, [string, string]> = {
  ig: ["@novastudio.co", "2.5K followers"],
  li: ["Nova Studio", "company page"],
  tt: ["@novastudio", "1.1K followers"],
  fb: ["Nova Studio", "Page"],
  yt: ["Nova Studio", "channel"],
};

function upsert(d: { accounts: ConnectedAccount[] }, platform: AccountPlatform, patch: Partial<ConnectedAccount>) {
  let acc = d.accounts.find((a) => a.platform === platform);
  if (!acc) {
    const meta = CONNECTABLE.find((c) => c.id === platform)!;
    acc = { id: newId("acc"), platform, badge: meta.badge, badgeBg: meta.bg, handle: "", status: "disconnected" };
    d.accounts.push(acc);
  }
  Object.assign(acc, patch);
  return acc;
}

/**
 * Start connecting. In http mode this is a full-page OAuth redirect owned by
 * the API. In mock mode the account goes to "connecting"; call
 * finishConnect to simulate the user finishing on the platform's tab.
 */
export async function startConnect(platform: AccountPlatform): Promise<ApiResult<ConnectedAccount>> {
  if (API_MODE === "http") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- external API origin
    window.location.assign(`${API_URL}/v1/accounts/oauth/${platform}`);
    return { ok: false, error: "network" };
  }
  return write((d) => upsert(d, platform, { status: "connecting" }));
}

/** Mock only: the OAuth tab finishes. The first try for platforms in declineFirstConnect is declined. */
export async function finishConnect(platform: AccountPlatform): Promise<ApiResult<ConnectedAccount>> {
  await new Promise((r) => setTimeout(r, mockConfig.latencyMs ? mockConfig.connectMs : 0));
  return write((d) => {
    const acc = d.accounts.find((a) => a.platform === platform);
    // Cancelled meanwhile.
    if (!acc || acc.status !== "connecting") return "conflict";
    const attempt = (d.connectAttempts[platform] = (d.connectAttempts[platform] ?? 0) + 1);
    if (attempt === 1 && mockConfig.declineFirstConnect.includes(platform)) {
      return upsert(d, platform, { status: "declined" });
    }
    const [handle, note] = SAMPLE_HANDLES[platform];
    return upsert(d, platform, { status: "connected", handle, note });
  });
}

export async function cancelConnect(platform: AccountPlatform): Promise<ApiResult<ConnectedAccount>> {
  if (API_MODE === "http") return apiFetch<ConnectedAccount>(`/v1/accounts/${platform}/cancel`, { method: "POST" });
  return write((d) => upsert(d, platform, { status: "disconnected" }));
}

export async function disconnectAccount(platform: AccountPlatform): Promise<ApiResult<ConnectedAccount>> {
  if (API_MODE === "http") return apiFetch<ConnectedAccount>(`/v1/accounts/${platform}`, { method: "DELETE" });
  return write((d) => upsert(d, platform, { status: "disconnected", handle: "", note: undefined }));
}
