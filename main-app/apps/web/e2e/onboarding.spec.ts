import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const heading = (page: Page) => page.locator("#app-main h1");
const alert = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });

/** Sign up through the UI; leaves the page on the first onboarding step. */
async function signUp(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Ada Obi");
  await page.getByLabel("Email or phone number").fill("ada@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Testing123");
  await page.getByRole("checkbox").check();
  const submit = page.getByRole("button", { name: "Create account" });
  await expect(submit).toHaveAttribute("aria-disabled", "false");
  await submit.click();
  await expect(page).toHaveURL(/\/code$/);
  await page.getByLabel("Digit 1").fill("123456");
  await expect(page).toHaveURL(/\/app\/onboarding\/verify$/);
}

test("full onboarding: email check, two accounts, brand voice, then Home", async ({ page }) => {
  await signUp(page);
  await expect(heading(page)).toHaveText("Confirm you're a student");

  await page.getByLabel("School email address").fill("ada@stu.ui.edu.ng");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter the code we sent to")).toBeVisible();
  await page.getByLabel("Digit 1").fill("123456");

  await expect(page).toHaveURL(/\/app\/onboarding\/connect$/);
  const cta = page.getByRole("button", { name: /Connect an account to continue|Continue with/ });
  await expect(cta).toHaveText("Connect an account to continue");

  await page.getByRole("listitem").filter({ hasText: "Instagram" }).getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Finish signing in on the Instagram tab")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Instagram" }).getByText("Connected")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("listitem").filter({ hasText: "LinkedIn" }).getByRole("button", { name: "Connect" }).click();
  await expect(cta).toHaveText("Continue with 2 accounts", { timeout: 10_000 });
  await cta.click();

  await expect(page).toHaveURL(/\/app\/onboarding\/brand$/);
  await page.getByLabel("Brand name").fill("Ada's Atelier");
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText("You're set up")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ada's Atelier");
  await expect(page.getByText("Finish setting up")).toHaveCount(0);
});

test("not a student skips the check", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "I'm not a student" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding\/connect$/);
});

test("a declined permission offers Try again, which then connects", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "I'm not a student" }).click();
  const fb = page.getByRole("listitem").filter({ hasText: "Facebook" });
  await fb.getByRole("button", { name: "Connect" }).click();
  await expect(fb.getByText("Permission declined")).toBeVisible({ timeout: 10_000 });
  await fb.getByRole("button", { name: "Try again" }).click();
  await expect(fb.getByText("Connected")).toBeVisible({ timeout: 10_000 });
});

test("skipping leaves a Finish setting up card that resumes at the right step", async ({ page }) => {
  await signUp(page);
  await page.getByRole("button", { name: "I'm not a student" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding\/brand$/);

  await page.goto("/app");
  await expect(page.getByText("Finish setting up")).toBeVisible();
  await page.getByRole("link", { name: "Continue setup" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding\/brand$/);

  await page.goto("/app/onboarding");
  await expect(page).toHaveURL(/\/app\/onboarding\/brand$/);
});

test("tone picker keeps at most two, swapping the oldest", async ({ page }) => {
  await signUp(page);
  await page.goto("/app/onboarding/brand");
  const pressed = page.getByRole("button", { pressed: true }).filter({ hasText: /^(Warm|Playful|Professional|Bold)/ });
  await expect(pressed).toHaveCount(2);
  await page.getByRole("button", { name: /^Bold/ }).click();
  await expect(pressed).toHaveCount(2);
  await expect(page.getByText("Warm was swapped for Bold")).toBeVisible();
});

test("a wrong student code shows an error", async ({ page }) => {
  await signUp(page);
  await page.getByLabel("School email address").fill("ada@stu.ui.edu.ng");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Digit 1").fill("111111");
  await expect(alert(page, "That code isn't right")).toBeVisible();
});

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const path of ["/app/onboarding/verify", "/app/onboarding/connect", "/app/onboarding/brand"]) {
    test(`no serious accessibility violations on ${path}`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "bb_session", value: "mock", url: baseURL! }]);
      await page.goto(path);
      await heading(page).waitFor();
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page }).analyze();
      const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target).join(", ")})`)).toEqual([]);
    });
  }
});
