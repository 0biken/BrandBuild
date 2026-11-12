import { test as base } from "@playwright/test";
import { SEED_NOW } from "../src/lib/mock/clock";

export * from "@playwright/test";

/** Every spec runs on the demo data's "today", whatever the real date is. */
export const test = base.extend<{ seedClock: void }>({
  seedClock: [
    async ({ page }, use) => {
      await page.clock.setFixedTime(new Date(SEED_NOW));
      await use();
    },
    { auto: true },
  ],
});
