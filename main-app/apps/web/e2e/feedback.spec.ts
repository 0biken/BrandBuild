import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Tester feedback round 1: any demo code, brand kit, media import, analytics.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const png = (name: string) => ({ name, mimeType: "image/png", buffer: PNG });

async function signIn(page: Page, baseURL: string | undefined) {
  await page.context().addCookies([{ name: "bb_session", value: "mock", url: baseURL! }]);
}

test("in demo mode any 6-digit code gets past the code page", async ({ page }) => {
  await page.goto("/code");
  await expect(page.getByText(/Demo mode: no email is sent yet/)).toBeVisible();
  const verify = page.getByRole("button", { name: "Verify" });
  await expect(verify).toBeDisabled();
  await page.getByLabel("Digit 1").fill("482913");
  await expect(page).toHaveURL(/\/app(\/onboarding\/\w+)?$/);
});

test.describe("signed in", () => {
  test.beforeEach(async ({ page, baseURL }) => signIn(page, baseURL));

  test("analytics shows growth recommendations for each range", async ({ page }) => {
    await page.goto("/app/analytics");
    const grow = page.getByRole("region", { name: "Grow your accounts" });
    await expect(grow.getByRole("listitem")).toHaveCount(5);
    await expect(grow.getByText("Reconnect TikTok")).toBeVisible();
    await page.getByRole("tab", { name: "90 days" }).click();
    await expect(grow.getByText(/Based on your last 90 days/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top posts" })).toBeVisible();
  });

  test("brand kit saves a logo, colour and font", async ({ page }) => {
    await page.goto("/app/brand");
    await page.getByLabel("Logo file").setInputFiles(png("logo.png"));
    await expect(page.getByRole("img", { name: "Your logo" })).toBeVisible();
    await page.getByLabel("Primary colour hex").fill("#D62976");
    await page.getByLabel("Heading font").selectOption("Playfair Display");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Brand kit saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("img", { name: "Your logo" })).toBeVisible();
    await expect(page.getByLabel("Heading font")).toHaveValue("Playfair Display");
    await expect(page.getByLabel("Primary colour hex")).toHaveValue("#D62976");
  });

  test("composer imports several photos, reorders them and keeps them on the draft", async ({ page }) => {
    await page.goto("/app/compose?draft=draft-1");
    await expect(page.getByLabel("Caption", { exact: true })).toHaveValue(/Three shades/);

    await page.getByLabel("Import photos or videos").setInputFiles([png("first.png"), png("second.png")]);
    const attached = page.getByRole("list", { name: "Attached media" }).getByRole("listitem");
    await expect(attached).toHaveCount(2);
    await expect(attached.first()).toContainText("Cover");

    await page.getByRole("button", { name: "Move second.png earlier" }).click();
    await expect(attached.first().getByRole("img")).toHaveAttribute("alt", "second.png");

    await page.getByLabel("Import photos or videos").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
    await expect(page.getByText(/notes.txt isn't a supported photo or video/)).toBeVisible();

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/Draft saved/)).toBeVisible();
    await page.goto("/app/drafts");
    await expect(page.getByRole("list", { name: "2 attached" })).toBeVisible();
  });

  test("settings links to the brand kit", async ({ page }) => {
    await page.goto("/app/settings");
    await page.getByRole("main").getByRole("link", { name: /Brand kit/ }).click();
    await expect(page).toHaveURL(/\/app\/brand#kit$/);
  });

  for (const path of ["/app/analytics", "/app/brand"]) {
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

test("no page scrolls sideways on a phone", async ({ page, baseURL }) => {
  test.skip(test.info().project.name !== "phone", "phone only");
  await signIn(page, baseURL);
  for (const path of ["/", "/pricing", "/signup", "/code", "/app", "/app/analytics", "/app/brand", "/app/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
