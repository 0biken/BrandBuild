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

// ---------- Media ----------

export interface MediaRef {
  id: string;
  name: string;
  kind: "image" | "video";
  /** MIME type. */
  type: string;
  size: number;
  /** Seconds, for videos. */
  duration?: number;
  /** ISO time it was added. */
  addedAt: string;
  /** Hosted file URL (http mode). Mock files resolve from the browser store. */
  url?: string;
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
  /** Photos and videos, in the order they appear. */
  media?: MediaRef[];
  reviewer?: {
    name: string;
    initial: string;
    note: string;
  };
  /** Who sent it for approval. Set while the post awaits approval. */
  requestedBy?: { name: string; initial: string };
  /** When it was sent for approval (ISO). */
  requestedAt?: string;
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
  /** The reviewer's note when they asked for changes. */
  feedback?: string;
  /** Photos and videos attached so far. */
  media?: MediaRef[];
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

export type AnalyticsRange = "7d" | "30d" | "90d";
export type PostFormat = "Reel" | "Carousel" | "Photo" | "Video";

/** One published post's results. */
export interface PostPerformance {
  id: string;
  title: string;
  format: PostFormat;
  platforms: PlatformId[];
  /** ISO time it went out. */
  postedAt: string;
  reach: number;
  /** Likes + comments + shares + saves. */
  engagements: number;
  saves: number;
  hashtags: number;
  captionLength: number;
}

export interface AnalyticsTotals {
  reach: number;
  engagements: number;
  followers: number;
  posts: number;
}

export interface AnalyticsReport {
  range: AnalyticsRange;
  /** ISO day the range starts and ends (inclusive). */
  from: string;
  to: string;
  totals: AnalyticsTotals;
  previous: AnalyticsTotals;
  /** One point per day, oldest first; `previous` is the same day of the prior period. */
  daily: { date: string; engagements: number; previous: number }[];
  platforms: { id: PlatformId; name: string; k: string; bg: string; engagements: number }[];
  /**
   * When followers are active: 7 weekdays (0 = Monday) x 6 slots of 3 hours
   * from 6 AM. Scores are 0-1.
   */
  heatmap: number[][];
  /** Posts published in the range, newest first. */
  posts: PostPerformance[];
  accounts: { platform: string; handle: string; status: ConnectedAccount["status"] }[];
}

// ---------- Brand ----------

export type Tone = "Warm" | "Playful" | "Professional" | "Bold";

export interface Brand {
  id: string;
  name: string;
  /** Short description of the voice, e.g. "warm, confident". */
  voice: string;
  plan: "student" | "creator" | "business";
  /** When the current plan or Student Access ends (open decision). */
  planEndsLabel: string;
  sells: string;
  audience: string[];
  /** One or two tones. */
  tones: Tone[];
  wordsUse: string[];
  wordsAvoid: string[];
  /** Hex colour used in graphics Brandbuild makes (the primary brand colour). */
  color: string;
  /** Up to three supporting colours (hex), after the primary. */
  palette?: string[];
  /** Logo as a data URL (PNG, JPG, WebP or SVG). */
  logo?: string;
  /** Font names from BRAND_FONTS in lib/brandKit.ts. */
  fonts?: { heading: string; body: string };
  /** Captions the owner wrote and liked, for voice matching. */
  samples: string;
}

export type BrandProfile = Omit<Brand, "id" | "plan" | "planEndsLabel" | "voice">;

// ---------- Settings ----------

export interface NotificationPrefs {
  postReminders: boolean;
  scheduledAlerts: boolean;
  weeklyInsights: boolean;
}

// ---------- Notifications ----------

export type NotificationKind = "approval" | "failed" | "reconnect" | "published" | "insights";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** When it happened (ISO). */
  at: string;
  read: boolean;
  /** In-app path the notification opens. */
  href: string;
}

// ---------- Onboarding ----------

export type StepStatus = "todo" | "done" | "skipped";

export interface OnboardingState {
  verify: StepStatus;
  connect: StepStatus;
  brand: StepStatus;
}

export interface StudentCheck {
  status: "none" | "code_sent" | "verified" | "pending_review" | "not_student";
  method?: "email" | "id";
  email?: string;
}

// ---------- Accounts ----------

/** Platforms an account can be connected for. YouTube is connect-only for now. */
export type AccountPlatform = PlatformId | "yt";

export interface ConnectedAccount {
  id: string;
  platform: AccountPlatform;
  badge: string;
  badgeBg: string;
  handle: string;
  /** e.g. "2.5K followers" or "company page". */
  note?: string;
  status: "connected" | "needs_attention" | "disconnected" | "connecting" | "declined";
}
