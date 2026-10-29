import { mockConfig } from "@/lib/mock/store";
import { API_MODE } from "./config";
import { apiFetch } from "./http";
import type { ApiResult, PlatformId } from "./types";

export type Tone = "Warm" | "Playful" | "Professional" | "Bold";
export type Tweak = "rewrite" | "shorter" | "playful" | "cta";

export interface GenerateInput {
  idea: string;
  tone: Tone;
  platforms: PlatformId[];
  tweak?: Tweak;
  /** The current caption, for tweaks. */
  caption?: string;
}

export interface Generated {
  caption: string;
  hashtags: string[];
  /** ISO timestamp of the suggested slot. */
  bestTime: string;
}

/**
 * Write a caption in the brand voice. The mock assembles a caption from the
 * idea with simple templates; the real call goes to the API's AI gateway,
 * which owns prompts, budgets and fact checks.
 */
export async function generatePost(input: GenerateInput): Promise<ApiResult<Generated>> {
  if (API_MODE === "http") return apiFetch<Generated>("/v1/ai/generate", { method: "POST", body: input });

  await new Promise((r) => setTimeout(r, mockConfig.latencyMs ? 2800 : 0));
  if (mockConfig.failNext) {
    const error = mockConfig.failNext;
    mockConfig.failNext = null;
    return { ok: false, error };
  }
  const idea = input.idea.trim().replace(/[.!?]+$/, "");
  const lead = idea.charAt(0).toUpperCase() + idea.slice(1);

  const OPENERS: Record<Tone, string> = {
    Warm: `${lead}. We put a lot of care into this one, and we think you'll feel it.`,
    Playful: `Plot twist: ${idea.charAt(0).toLowerCase() + idea.slice(1)}. You're going to want to see this.`,
    Professional: `${lead}. Here's what goes into it, and why it matters to the people we make it for.`,
    Bold: `${lead}. No shortcuts. No filler. Just the real thing.`,
  };
  const CTA = "Turn on post notifications so you don't miss it.";

  let caption = OPENERS[input.tone];
  if (input.tweak === "shorter" && input.caption) caption = `${input.caption.split(/(?<=[.!?])\s/)[0]}`;
  else if (input.tweak === "playful") caption = OPENERS.Playful;
  else if (input.tweak === "cta") caption = `${input.caption ?? caption}\n\n${CTA}`;
  else if (input.tweak !== "rewrite") caption = `${caption}\n\n${CTA}`;

  const words = idea
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 2);
  const hashtags = ["#smallbusiness", ...words.map((w) => `#${w}`), "#shoplocal"];

  // Next Friday, 7 PM (the sample data's "best time").
  const best = new Date();
  best.setDate(best.getDate() + ((5 - best.getDay() + 7) % 7 || 7));
  best.setHours(19, 0, 0, 0);

  return { ok: true, data: { caption, hashtags, bestTime: best.toISOString() } };
}
