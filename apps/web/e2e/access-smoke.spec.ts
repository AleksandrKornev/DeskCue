import { expect, test } from "@playwright/test";

import { requireE2eBaseUrl } from "./helpers";

test.describe("access tab smoke", () => {
  test.beforeEach(() => {
    requireE2eBaseUrl();
  });

  test("renders pairing and token management surfaces", async ({ page }) => {
    await page.goto("/settings?tab=access");

    await expect(page.getByRole("tab", { name: "Access" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Pair devices" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Create device link|Creating/ })).toBeVisible();
    await expect(page.getByText("Other active tokens")).toBeVisible();
  });
});
