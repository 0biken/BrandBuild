import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "bb_session", value: "mock", url: baseURL! }]);
});

const list = (page: Page) => page.getByRole("region", { name: "Posts to review" });
const review = (page: Page) => page.getByRole("region", { name: "Review" });
const open = (page: Page, title: RegExp) => list(page).getByRole("button", { name: title }).click();

test("approve, then undo", async ({ page }) => {
  await page.goto("/app/approvals");
  await expect(page.getByText("3 waiting for you")).toBeVisible();
  await open(page, /Weekend gloss giveaway/);

  await review(page).getByRole("button", { name: "Approve and schedule" }).click();
  await expect(review(page).getByRole("status")).toContainText("Approved. Scheduled for Sat 7 Nov, 6:00 PM");
  await expect(page.getByText("2 waiting for you")).toBeVisible();

  await review(page).getByRole("button", { name: "Undo" }).click();
  await expect(review(page).getByRole("button", { name: "Approve and schedule" })).toBeVisible();
  await expect(page.getByText("3 waiting for you")).toBeVisible();
});

test("request changes sends the note to Drafts", async ({ page }) => {
  await page.goto("/app/approvals");
  await open(page, /two people who pack/);
  const send = review(page).getByRole("button", { name: "Send to Tobi" });

  await review(page).getByRole("button", { name: "Request changes" }).click();
  await expect(send).toBeDisabled();
  await review(page).getByLabel("What should Tobi change?").fill("Use the packing table photo.");
  await send.click();
  await expect(review(page).getByRole("status")).toContainText("Sent back to Tobi");

  await page.goto("/app/drafts");
  await expect(page.getByText("Use the packing table photo.")).toBeVisible();
});

test("a link from Post detail opens that post, and reject moves it to Drafts", async ({ page }) => {
  await page.goto("/app/posts/post-3");
  await page.getByRole("link", { name: "Review now" }).click();
  await expect(page).toHaveURL(/\/app\/approvals\?post=post-3$/);
  await expect(review(page).getByRole("heading", { name: /Customer shout-out/ })).toBeVisible();

  await review(page).getByRole("button", { name: "Reject" }).click();
  await expect(review(page).getByRole("status")).toContainText("Rejected");
  await page.goto("/app/drafts");
  await expect(page.getByRole("heading", { name: /Customer shout-out/ })).toBeVisible();
});

test("editors see who must approve, with no decision buttons", async ({ page }) => {
  await page.goto("/app/approvals");
  await page.evaluate(() => (window as unknown as { __bbMock: { setRole(r: string): void } }).__bbMock.setRole("editor"));
  await page.reload();
  await open(page, /Weekend gloss giveaway/);
  await expect(review(page).getByText("Only the owner or a reviewer can approve posts.")).toBeVisible();
  await expect(review(page).getByRole("button", { name: "Approve and schedule" })).toHaveCount(0);
});

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  test("no serious accessibility violations on /app/approvals", async ({ page }) => {
    await page.goto("/app/approvals");
    await expect(list(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target).join(", ")})`)).toEqual([]);
  });
});
