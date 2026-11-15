import { afterEach, beforeEach, vi } from "vitest";
import { SEED_NOW } from "@/lib/mock/clock";

// Freeze only Date, so timers still run. Tests can still call vi.useFakeTimers.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(SEED_NOW) });
});

afterEach(() => {
  vi.useRealTimers();
});
