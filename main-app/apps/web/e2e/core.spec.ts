import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "bb_session", value: "mock", url: baseURL! }]);
});

const heading = (page: Page) => page.locator("#app-main h1");
// Radios and checkboxes are visually hidden inputs under styled labels,
// so the tests check them with { force: true }.

test("compose, generate, schedule, land on the post", async ({ page }) => {
  await page.goto("/app/compose?idea=Packing%20weekend%20orders");
  await page.getByRole("button", { name: "Generate post" }).click();
  await expect(page.getByRole("region", { name: "Generating" })).toBeVisible();
  await expect(page.getByLabel("Caption", { exact: true })).toHaveValue(/Packing weekend orders/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Schedule post" })).toBeEnabled({ timeout: 10_000 });

  await page.getByRole("button", { name: "Remove #smallbusiness" }).click();
  await expect(page.getByText("#smallbusiness")).toHaveCount(0);

  await page.getByRole("button", { name: "Schedule post" }).click();
  await expect(page).toHaveURL(/\/app\/posts\/post-/);
  await expect(heading(page)).toHaveText("Packing weekend orders");
  await expect(page.locator("#app-main header")).toContainText("Scheduled");
});

test("composer blocks scheduling with no platform", async ({ page }) => {
  await page.goto("/app/compose?idea=Restock");
  await page.getByRole("button", { name: "Generate post" }).click();
  await expect(page.getByRole("button", { name: "Schedule post" })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("checkbox", { name: /Instagram/ }).uncheck({ force: true });
  await page.getByRole("checkbox", { name: /LinkedIn/ }).uncheck({ force: true });
  await page.getByRole("button", { name: "Schedule post" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Pick at least one platform" })).toBeVisible();
});

test("a draft opens prefilled and can be saved", async ({ page }) => {
  await page.goto("/app/compose?draft=draft-1");
  await expect(page.getByLabel("What's this post about?")).toHaveValue("Halloween shade picks");
  await expect(page.getByLabel("Caption", { exact: true })).toHaveValue(/Three shades/);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft saved/)).toBeVisible();
});

test("failed post offers retry; retry moves it to scheduled", async ({ page }) => {
  await page.goto("/app/posts/post-6");
  await expect(page.getByRole("alert").filter({ hasText: "Didn't post to Instagram" })).toBeVisible();
  await page.getByRole("button", { name: "Retry as is" }).click();
  await expect(page.locator("#app-main header")).toContainText("Scheduled");
});

test("unclear post warns against reposting and offers no retry or edit", async ({ page }) => {
  await page.goto("/app/posts/post-7");
  await expect(page.getByText("Please don't post it again yourself")).toBeVisible();
  await expect(page.getByRole("button", { name: /Retry/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
});

test("paused post explains the hold", async ({ page }) => {
  await page.goto("/app/posts/post-8");
  await expect(page.getByText("Publishing is paused for this workspace")).toBeVisible();
});

test("withdrawing an approval request moves the post to Drafts", async ({ page }) => {
  await page.goto("/app/posts/post-3");
  await page.getByRole("button", { name: "Withdraw request" }).click();
  await expect(page).toHaveURL(/\/app\/drafts$/);
  await expect(page.getByRole("heading", { name: /Customer shout-out/ })).toBeVisible();
});

test("reschedule from the post page", async ({ page }) => {
  await page.goto("/app/posts/post-4");
  await page.getByRole("button", { name: "Reschedule" }).click();
  const dialog = page.getByRole("dialog", { name: "Reschedule" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Date").fill("2027-01-15");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#app-main h1 + span")).toContainText("Fri 15 Jan");
});

test("delete asks first", async ({ page }) => {
  await page.goto("/app/posts/post-4");
  await page.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this post?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Delete" }).click();
  await dialog.getByRole("button", { name: "Delete post" }).click();
  await expect(page).toHaveURL(/\/app\/calendar$/);
});

test("calendar views, filters and day panel", async ({ page }) => {
  await page.goto("/app/calendar");
  await expect(heading(page)).toContainText(/\d{4}/);
  await page.getByRole("radio", { name: "list" }).check({ force: true });
  await expect(page.getByRole("region", { name: "Posts this month" })).toBeVisible();
  await page.getByRole("radio", { name: "week" }).check({ force: true });
  await expect(page.getByRole("button", { name: "Next week" })).toBeVisible();
  await page.getByRole("radio", { name: "month" }).check({ force: true });

  const tiktok = page.getByRole("button", { name: "TikTok", exact: true });
  await tiktok.click();
  await expect(tiktok).toHaveAttribute("aria-pressed", "false");
});

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const path of ["/app/calendar", "/app/compose?idea=Test", "/app/posts/post-1", "/app/posts/post-6"]) {
    test(`no serious accessibility violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await heading(page).waitFor();
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page }).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target).join(", ")})`)).toEqual([]);
    });
  }
});
