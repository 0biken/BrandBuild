import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";

/** Next's route announcer is also role="alert", so match by text. */
const alert = (page: Page, text: string) => page.getByRole("alert").filter({ hasText: text });

test("signed-out visitors to the app are sent to log in", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp/);
});

test("signup, then the code, starts onboarding", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Test User");
  await page.getByLabel("Email or phone number").fill("test@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Testing123");
  await page.getByRole("checkbox").check();
  // aria-disabled only flips once React has hydrated; clicking earlier would
  // submit the form natively and reload the page.
  const submit = page.getByRole("button", { name: "Create account" });
  await expect(submit).toHaveAttribute("aria-disabled", "false");
  await submit.click();

  await expect(page).toHaveURL(/\/code$/);
  await expect(page.getByText("test@example.test")).toBeVisible();

  await page.getByLabel("Digit 1").fill("111111");
  await expect(alert(page, "That code isn't right")).toBeVisible();

  await page.getByLabel("Digit 1").fill("123456");
  const done = page.getByRole("dialog", { name: "Account created" });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Continue" }).click();
  // A new account continues into onboarding.
  await expect(page).toHaveURL(/\/app\/onboarding\/verify$/);
});

test("logging in shows Welcome back, then continues to where they were going", async ({ page }) => {
  await page.goto("/login?next=%2Fapp%2Fdrafts");
  await page.getByLabel("Email or phone number").fill("mary@novastudio.co");
  await page.getByLabel("Password", { exact: true }).fill("Glossdrop26");
  const submit = page.getByRole("button", { name: "Log in" });
  await expect(submit).toHaveAttribute("aria-disabled", "false");
  await submit.click();
  const done = page.getByRole("dialog", { name: "Welcome back" });
  await expect(done.getByText("You're now logged in.")).toBeVisible();
  await expect(done.getByRole("button", { name: "Continue" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/drafts$/);
});

test("a password reset ends on the Password changed pop-up", async ({ page }) => {
  await page.goto("/reset");
  await page.getByLabel("Email or phone number").fill("mary@novastudio.co");
  const send = page.getByRole("button", { name: "Send code" });
  await expect(send).toBeEnabled();
  await send.click();
  await page.getByLabel("Digit 1").fill("123456");
  await page.getByLabel("New password").fill("Brandnew2026");
  await page.getByRole("button", { name: "Save new password" }).click();
  const done = page.getByRole("dialog", { name: "Password changed" });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/app(\/onboarding\/\w+)?$/);
});

test("wrong password shows the mismatch error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email or phone number").fill("test@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrongpass1");
  const submit = page.getByRole("button", { name: "Log in" });
  await expect(submit).toHaveAttribute("aria-disabled", "false");
  await submit.click();
  await expect(alert(page, "don't match")).toBeVisible();
});

// Reduced motion skips the GSAP entrances, so axe sees final colours.
test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });

for (const path of ["/", "/pricing", "/legal", "/signup", "/login", "/code", "/reset"]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}
});
