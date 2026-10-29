import type {
  ApiError,
  ApiResult,
  Brand,
  ConnectedAccount,
  DraftItem,
  PlatformConfig,
  PostItem,
  StatItem,
} from "@/lib/api/types";
import {
  SEED_ACCOUNTS,
  SEED_BRAND,
  SEED_DRAFTS,
  SEED_PLATFORMS,
  SEED_POSTS,
  SEED_STATS,
} from "./seed-data";

/**
 * In-memory mock back end. Seeded from seed-data.ts and saved to
 * sessionStorage, so edits survive a reload but a new tab starts clean.
 * Only src/lib/api/* may import this; components go through the API.
 */

export interface MockDb {
  posts: PostItem[];
  drafts: DraftItem[];
  accounts: ConnectedAccount[];
  platforms: PlatformConfig[];
  stats: StatItem[];
  brand: Brand;
}

const STORAGE_KEY = "bb:mock-db:v1";

const seed = (): MockDb =>
  structuredClone({
    posts: SEED_POSTS,
    drafts: SEED_DRAFTS,
    accounts: SEED_ACCOUNTS,
    platforms: SEED_PLATFORMS,
    stats: SEED_STATS,
    brand: SEED_BRAND,
  });

let db: MockDb | null = null;

function load(): MockDb {
  if (db) return db;
  db = seed();
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) db = { ...db, ...(JSON.parse(raw) as Partial<MockDb>) };
    } catch {
      /* storage blocked or corrupt: fall back to the seed */
    }
  }
  return db;
}

function save() {
  if (typeof window === "undefined" || !db) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* storage blocked: changes last until reload */
  }
}

/** Dev knobs, also reachable from the console as window.__bbMock. */
export const mockConfig = {
  latencyMs: 400,
  /** When set, the next mock call fails with this error, then clears. */
  failNext: null as ApiError | null,
};

if (typeof window !== "undefined") {
  (window as unknown as { __bbMock: unknown }).__bbMock = {
    config: mockConfig,
    reset: resetMockDb,
  };
}

/** Read-only access to the current data, with simulated latency. */
export async function read<T>(pick: (d: MockDb) => T): Promise<ApiResult<T>> {
  await new Promise((r) => setTimeout(r, mockConfig.latencyMs));
  if (mockConfig.failNext) {
    const error = mockConfig.failNext;
    mockConfig.failNext = null;
    return { ok: false, error };
  }
  return { ok: true, data: structuredClone(pick(load())) };
}

/**
 * Apply a change. The mutator returns the result data, or an ApiError to
 * reject the change without saving.
 */
export async function write<T>(
  mutate: (d: MockDb) => T | ApiError,
): Promise<ApiResult<T>> {
  const res = await read(() => null);
  if (!res.ok) return res;
  const out = mutate(load());
  if (typeof out === "string" && isApiError(out)) return { ok: false, error: out };
  save();
  return { ok: true, data: structuredClone(out) as T };
}

export function resetMockDb() {
  db = seed();
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ERRORS: ReadonlySet<string> = new Set<ApiError>([
  "invalid",
  "expired",
  "network",
  "not_found",
  "forbidden",
  "conflict",
]);
const isApiError = (v: string): v is ApiError => ERRORS.has(v);
