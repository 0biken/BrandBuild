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

test("brand profile edits are saved, and Home picks up the new name", async ({ page }) => {
  await page.goto("/app/brand");
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(page.getByLabel("Brand name")).toHaveValue("Nova Studio");
  await expect(save).toBeDisabled();
  await page.getByLabel("Brand name").fill("Nova Studio Co");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("Brand kit saved.")).toBeVisible();
  await expect(save).toBeDisabled();
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Nova Studio Co");
});

test("discarding brand profile changes restores the saved values", async ({ page }) => {
  await page.goto("/app/brand");
  await page.getByLabel("Brand name").fill("Something else");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByLabel("Brand name")).toHaveValue("Nova Studio");
});

test("the Home bell shows unread notifications and opens the list", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("link", { name: "Notifications, 3 unread" }).click();
  await expect(page).toHaveURL(/\/app\/notifications$/);
  await expect(page.getByText("3 unread")).toBeVisible();
});

test("opening a notification marks it read and goes to the post", async ({ page }) => {
  await page.goto("/app/notifications");
  await page.getByRole("link", { name: /Weekend gloss giveaway needs your approval/ }).click();
  await expect(page).toHaveURL(/\/app\/approvals\?post=post-9$/);
  // The mock store saves after a short delay; wait for Approvals' data
  // (fetched after the save started) before reloading.
  await expect(page.getByRole("main").getByText("Weekend gloss giveaway").filter({ visible: true }).first()).toBeVisible();
  await page.goto("/app/notifications");
  await expect(page.getByText("2 unread")).toBeVisible();
});

test("mark all as read empties the Unread tab", async ({ page }) => {
  await page.goto("/app/notifications");
  await page.getByRole("tab", { name: "Unread (3)" }).click();
  await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByText("No unread notifications")).toBeVisible();
  await expect(page.getByText("You're all caught up")).toBeVisible();
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(page.getByRole("tabpanel").getByRole("listitem")).toHaveCount(6);
});

test("planned screens say they're coming, unknown ones 404", async ({ page }) => {
  await page.goto("/app/billing");
  await expect(page.getByText("This screen is on its way")).toBeVisible();
  const res = await page.goto("/app/not-a-screen");
  expect(res?.status()).toBe(404);
});

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const path of ["/app", "/app/drafts", "/app/notifications"]) {
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
