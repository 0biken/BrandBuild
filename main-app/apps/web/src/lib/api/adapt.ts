/**
 * Turns the API's plain data (docs/api/openapi.yaml) into the shapes the screens use,
 * and back. The API sends data only; labels, colours and formatted dates are added here.
 * Mock mode doesn't pass through this file: its store already holds the screen shapes.
 */
import { formatShort, scheduleFields } from "@/lib/postDates";
import { API_URL } from "./config";
import type { components } from "./schema.gen";
import type {
  ApiResult,
  Brand,
  ConnectedAccount,
  DraftItem,
  DraftState,
  MediaRef,
  PlatformConfig,
  PlatformId,
  PostItem,
  StatItem,
} from "./types";

type Schemas = components["schemas"];
export type ApiDraft = Schemas["Draft"];
export type ApiPost = Schemas["Post"];
export type ApiBrand = Schemas["Brand"];
export type ApiMedia = Schemas["MediaRef"];
export type ApiPlatform = Schemas["Platform"];
export type ApiAccount = Schemas["ConnectedAccount"];
export type ApiStat = Schemas["StatItem"];

/** Apply `fn` to a successful result; pass failures through. */
export function mapResult<A, B>(res: ApiResult<A>, fn: (data: A) => B): ApiResult<B> {
  return res.ok ? { ok: true, data: fn(res.data) } : res;
}

export const PLATFORM_META: Record<string, { k: string; bg: string; name: string }> = {
  ig: { k: "IG", bg: "#D62976", name: "Instagram" },
  li: { k: "in", bg: "#0A66C2", name: "LinkedIn" },
  tt: { k: "TT", bg: "#111111", name: "TikTok" },
  fb: { k: "f", bg: "#1877F2", name: "Facebook" },
  yt: { k: "YT", bg: "#E6002E", name: "YouTube" },
};

const DOT = { green: "#12A150", grey: "#9AA39C" };
const initial = (name: string) => name.trim().charAt(0).toUpperCase();

// ----------------------------------------------------------------- media

export function fromApiMedia(m: ApiMedia): MediaRef {
  // The API gives a path under its own root; the browser reaches it through API_URL.
  return { ...m, url: m.url?.startsWith("/") ? `${API_URL}${m.url}` : m.url };
}

/** Only the id matters to the API; it looks the rest up. */
const toApiMedia = (media: MediaRef[]) => media.map((m) => ({ ...m, url: undefined }));

// ---------------------------------------------------------------- drafts

const DRAFT_LABEL: Record<ApiDraft["state"], DraftState> = {
  ready: "Ready",
  needs_photo: "Needs a photo",
  idea: "Idea",
};
const DRAFT_ACTION: Record<DraftState, string> = {
  Ready: "Schedule",
  "Needs a photo": "Add photo",
  Idea: "Write it",
};

/** "Edited 2 hours ago" */
export function editedLabel(iso: string, now = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  const plural = (n: number, unit: string) => `Edited ${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (minutes < 60) return plural(minutes, "minute");
  if (minutes < 60 * 24) return plural(Math.round(minutes / 60), "hour");
  return plural(Math.round(minutes / (60 * 24)), "day");
}

export function fromApiDraft(d: ApiDraft): DraftItem {
  const state = DRAFT_LABEL[d.state];
  return {
    id: d.id,
    title: d.title,
    body: d.body,
    state,
    pfs: d.platforms.map((id) => ({
      k: PLATFORM_META[id].k,
      bg: PLATFORM_META[id].bg,
    })),
    edited: editedLabel(d.updatedAt),
    action: DRAFT_ACTION[state],
    ...(d.feedback ? { feedback: d.feedback } : {}),
    media: (d.media ?? []).map(fromApiMedia),
    ...(d.scheduledAt ? { scheduledAt: d.scheduledAt } : {}),
    ...(d.source ? { source: { ...d.source, kind: "ai_plan" as const } } : {}),
  };
}

/** Only the fields present in `patch` are sent, so PATCH leaves the rest alone. */
export function toApiDraftInput(patch: Partial<Omit<DraftItem, "id">>): Schemas["DraftInput"] {
  const out: Schemas["DraftInput"] = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.body !== undefined) out.body = patch.body;
  if (patch.state !== undefined) {
    out.state = (Object.keys(DRAFT_LABEL) as ApiDraft["state"][]).find((k) => DRAFT_LABEL[k] === patch.state);
  }
  if (patch.pfs !== undefined) {
    out.platforms = patch.pfs
      .map((pf) => Object.keys(PLATFORM_META).find((id) => PLATFORM_META[id].k === pf.k))
      .filter((id): id is PlatformId => id === "ig" || id === "li" || id === "tt" || id === "fb");
  }
  if (patch.media !== undefined) out.media = toApiMedia(patch.media);
  return out;
}

// ----------------------------------------------------------------- posts

const compact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : n >= 1_000
      ? `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`
      : String(n);

export function fromApiPost(p: ApiPost): PostItem {
  const when = p.scheduledAt ? new Date(p.scheduledAt) : new Date();
  const notice = p.notice ? { title: p.notice.title, message: p.notice.message } : undefined;
  return {
    id: p.id,
    title: p.title,
    caption: p.caption,
    hashtags: p.hashtags,
    aspectRatio: p.aspectRatio,
    ...scheduleFields(when, p.state),
    state: p.state,
    platforms: p.platforms,
    activityLog: p.activity.map((a, i) => ({
      text: a.text,
      time: formatShort(new Date(a.at)),
      dot: i === 0 ? DOT.green : DOT.grey,
    })),
    media: (p.media ?? []).map(fromApiMedia),
    ...(p.platformStatuses
      ? {
          platformStatuses: p.platformStatuses.map((s) => ({
            id: s.id,
            ...PLATFORM_META[s.id],
            status: s.status,
            chipBg: s.live ? "#E7F6EC" : "#F1F3EF",
            chipFg: s.live ? "#0B7A3B" : "#4B5750",
            note: s.note ?? "",
            live: s.live,
            ...(s.liveUrl ? { liveUrl: s.liveUrl } : {}),
          })),
        }
      : {}),
    ...(p.metrics
      ? {
          metrics: {
            reach: compact(p.metrics.reach),
            likes: compact(p.metrics.likes),
            comments: compact(p.metrics.comments),
            saves: compact(p.metrics.saves),
          },
        }
      : {}),
    ...(p.reviewer ? { reviewer: { ...p.reviewer, initial: initial(p.reviewer.name) } } : {}),
    ...(p.requestedBy
      ? {
          requestedBy: {
            name: p.requestedBy.name,
            initial: initial(p.requestedBy.name),
          },
        }
      : {}),
    ...(p.requestedAt ? { requestedAt: p.requestedAt } : {}),
    ...(notice && p.state === "failed" ? { failureInfo: notice } : {}),
    ...(notice && p.state === "checking" ? { checkingInfo: notice } : {}),
    ...(notice && p.state === "paused" ? { pausedInfo: notice } : {}),
  };
}

export function toApiPostInput<T extends { media?: MediaRef[] }>(input: T): T {
  return input.media ? { ...input, media: toApiMedia(input.media) } : input;
}

// ----------------------------------------------------------------- brand

export function fromApiBrand(b: ApiBrand): Brand {
  const { planEndsAt, ...rest } = b;
  return {
    ...rest,
    planEndsLabel: planEndsAt
      ? new Date(planEndsAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "[END DATE]",
  };
}

// ---------------------------------------------------- accounts and platforms

export function fromApiAccount(a: ApiAccount): ConnectedAccount {
  const meta = PLATFORM_META[a.platform];
  return {
    id: a.id,
    platform: a.platform,
    badge: meta.k,
    badgeBg: meta.bg,
    handle: a.handle,
    ...(a.followers !== undefined ? { note: `${compact(a.followers)} followers` } : {}),
    status: a.status,
  };
}

/** A platform as the composer shows it: off until an account is connected. */
export function fromApiPlatform(p: ApiPlatform, accounts: ApiAccount[]): PlatformConfig {
  const account = accounts.find((a) => a.platform === p.id);
  const connected = account?.status === "connected";
  const warn = account?.status === "needs_attention";
  return {
    id: p.id,
    k: PLATFORM_META[p.id].k,
    bg: PLATFORM_META[p.id].bg,
    name: p.name,
    sub: connected ? account.handle : warn ? "Reconnect first" : p.enabled === false ? "Coming soon" : "Not connected",
    limit: p.limit,
    ...(warn ? { warn: true } : {}),
    ...(!connected && !warn ? { off: true } : {}),
  };
}

// ------------------------------------------------------------------ home

const STAT_LABEL: Record<string, string> = {
  engagements: "Engagements",
  followers: "New followers",
  link_clicks: "Link clicks",
  comments: "Comments",
};

/** Sparkline points for a 72 by 24 box, as the Home card draws them. */
function sparkPoints(values: number[]): string {
  if (values.length < 2) return "2,12 70,12";
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  return values
    .map((v, i) => {
      const x = 2 + Math.round((i * 68) / (values.length - 1));
      const y = span === 0 ? 12 : 20 - Math.round(((v - min) / span) * 16);
      return `${x},${y}`;
    })
    .join(" ");
}

export function fromApiStat(s: ApiStat): StatItem {
  // A number we don't have is shown as missing, never as 0.
  if (s.value === null || s.value === undefined) {
    return {
      label: STAT_LABEL[s.key] ?? s.key,
      value: "No data",
      missing: true,
      delta: "",
      deltaColor: "",
      isUp: true,
      spark: "",
      sparkColor: "",
    };
  }
  if (s.previous === null || s.previous === undefined) return fromApiStat({ ...s, previous: s.value });
  const isUp = s.value >= s.previous;
  const change = s.previous === 0 ? 0 : Math.abs(((s.value - s.previous) / s.previous) * 100);
  return {
    label: STAT_LABEL[s.key] ?? s.key,
    value: compact(s.value),
    delta: `${change.toFixed(1).replace(/\.0$/, "")}%`,
    deltaColor: isUp ? "#0B7A3B" : "#B42318",
    isUp,
    spark: sparkPoints(s.spark),
    sparkColor: isUp ? "#12A150" : "#B42318",
  };
}
