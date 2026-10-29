/**
 * The frontend's API contract. The mock back end (src/lib/mock) and the HTTP
 * back end (the Rust API) both return these shapes.
 *
 * Some fields are still presentation-shaped (colours, preformatted strings)
 * because they came straight from the design's sample data. Normalise them as
 * each screen is built against the real API.
 */

// ---------- Results ----------

export type ApiError =
  | "invalid"
  | "expired"
  | "network"
  | "not_found"
  | "forbidden"
  | "conflict";

export type ApiResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

// ---------- Auth ----------

export type Provider = "google" | "apple";
export type Role = "owner" | "editor" | "reviewer";

export interface Session {
  userId: string;
  name: string;
  identifier: string;
  role: Role;
}

// ---------- Posts ----------

export type PostState =
  | "scheduled"
  | "approval"
  | "published"
  | "failed"
  | "checking"
  | "paused";

export type PlatformId = "ig" | "li" | "tt" | "fb";

export interface PlatformConfig {
  id: PlatformId;
  k: string; // "IG", "in", "TT", "f"
  bg: string; // "#D62976", "#0A66C2", "#111111", "#1877F2"
  name: string;
  sub: string;
  limit: number;
  warn?: boolean;
  off?: boolean;
}

export interface PostPlatformStatus {
  id: PlatformId;
  k: string;
  bg: string;
  name: string;
  status: string;
  chipBg: string;
  chipFg: string;
  note: string;
  noteFg?: string;
  live: boolean;
  liveUrl?: string;
}

export interface ActivityItem {
  text: string;
  time: string;
  dot: string;
}

export interface PostItem {
  id: string;
  title: string;
  caption: string;
  hashtags: string[];
  aspectRatio: string;
  time: string;
  dateStr: string;
  scheduledFor: string;
  state: PostState;
  platforms: PlatformId[];
  platformStatuses?: PostPlatformStatus[];
  metrics?: {
    reach: string;
    likes: string;
    comments: string;
    saves: string;
    note?: string;
  };
  activityLog: ActivityItem[];
  reviewer?: {
    name: string;
    initial: string;
    note: string;
  };
  failureInfo?: {
    title: string;
    message: string;
  };
  checkingInfo?: {
    title: string;
    message: string;
  };
  pausedInfo?: {
    title: string;
    message: string;
  };
}

// ---------- Drafts ----------

export type DraftState = "Ready" | "Needs a photo" | "Idea";

export interface DraftItem {
  id: string;
  title: string;
  body: string;
  state: DraftState;
  pfs: { k: string; bg: string }[];
  edited: string;
  action: string;
}

// ---------- Analytics ----------

export interface StatItem {
  label: string;
  value: string;
  delta: string;
  deltaColor: string;
  isUp: boolean;
  spark: string;
  sparkColor: string;
}

// ---------- Accounts ----------

export interface ConnectedAccount {
  id: string;
  platform: "ig" | "li" | "tt";
  badge: string;
  badgeBg: string;
  handle: string;
  status: "connected" | "needs_attention" | "disconnected";
}
