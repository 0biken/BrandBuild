import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Signed in via the mock session cookie the proxy checks.
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "bb_session", value: "mock", url: baseURL! }]);
});

test("home shows the brand, stats and up-next posts", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Nova Studio");
  await expect(page.getByText("Engagements")).toBeVisible();
  await expect(page.getByRole("link", { name: /Drop is live/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "TikTok needs reconnecting" })).toBeVisible();
});

test("the post idea carries into the composer link", async ({ page }) => {
  await page.goto("/app");
  await page.getByLabel("What do you want to post about?").fill("Packing orders");
  await page.getByRole("button", { name: "Generate post" }).click();
  await expect(page).toHaveURL(/\/app\/compose\?idea=Packing\+orders|\/app\/compose\?idea=Packing%20orders/);
});

test("drafts filter, delete and undo", async ({ page }) => {
  await page.goto("/app/drafts");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drafts 6");

  await page.getByRole("tab", { name: /Ideas only/ }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByRole("tab", { name: /^All/ }).click();

  await page.getByRole("button", { name: "More actions for Lip care routine, 3 steps" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drafts 5");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drafts 6");
  await expect(page.getByRole("heading", { name: "Lip care routine, 3 steps" })).toBeVisible();
});

test("search with no match offers a way back", async ({ page }) => {
  await page.goto("/app/drafts");
  await page.getByLabel("Search drafts").fill("zzzz");
  await expect(page.getByText('Nothing matches "zzzz"')).toBeVisible();
  await page.getByRole("button", { name: "Show all drafts" }).click();
  await expect(page.getByRole("article")).toHaveCount(6);
});

test("planned screens say they're coming, unknown ones 404", async ({ page }) => {
  await page.goto("/app/settings");
  await expect(page.getByText("This screen is on its way")).toBeVisible();
  const res = await page.goto("/app/not-a-screen");
  expect(res?.status()).toBe(404);
});

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const path of ["/app", "/app/drafts"]) {
    test(`no serious accessibility violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page }).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target).join(", ")})`)).toEqual([]);
    });
  }
});
