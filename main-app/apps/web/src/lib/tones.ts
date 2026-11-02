import type { Tone } from "@/lib/api/types";

/** Tone options with example lines and sample posts (BrandSetup design). */
export const TONES: { label: Tone; eg: string; sample: string }[] = [
  {
    label: "Warm",
    eg: "Packed by hand, with a note from us.",
    sample: "Every order is packed by hand and sealed with a note from the team. Your new favourite shade is on its way.",
  },
  {
    label: "Playful",
    eg: "Your lips called. They want the new shade.",
    sample: "Plot twist: your lips called and they want the new shade. Friday, 7 PM. Don’t keep them waiting.",
  },
  {
    label: "Professional",
    eg: "Handmade in small batches. Tested by our team.",
    sample: "Our new lip care line launches Friday. Handmade in small batches and tested by our team before it reaches you.",
  },
  { label: "Bold", eg: "New drop. Five shades. No restocks.", sample: "New drop. Five shades. No restocks. Friday, 7 PM." },
];

export const MAX_TONES = 2;

/**
 * Toggle a tone. Up to two; picking a third replaces the oldest, and the last
 * one can't be removed (a voice needs at least one tone).
 */
export function toggleTone(current: Tone[], tone: Tone): Tone[] {
  if (current.includes(tone)) return current.length > 1 ? current.filter((t) => t !== tone) : current;
  return [...current, tone].slice(-MAX_TONES);
}
