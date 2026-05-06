import { expect, test } from "@playwright/test";

// Smoke tests that don't require an authenticated session — they verify the
// proxy.ts redirect rules and that /login renders.

test.describe("unauthenticated", () => {
  test("home redirects to /login with no callbackUrl", async ({ page }) => {
    const response = await page.goto("/");
    await expect(page).toHaveURL(/\/login(\?|$)/);
    expect(response?.ok()).toBeTruthy();
  });

  test("a pad URL redirects to /login with the path captured as callbackUrl", async ({
    page,
  }) => {
    await page.goto("/pad/abc123");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fpad%2Fabc123/);
  });

  test("/me redirects to /login", async ({ page }) => {
    await page.goto("/me");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fme/);
  });

  test("/admin/* redirects to /login", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fadmin%2Fusers/);
  });

  test("login page renders Google sign-in button", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: /Continue with Google/i })
    ).toBeVisible();
  });

  test("login page surfaces ?error=… as a friendly message", async ({
    page,
  }) => {
    await page.goto("/login?error=OAuthAccountNotLinked");
    await expect(page.getByText(/Sign-in failed/i)).toBeVisible();
  });
});
