import { expect, test } from "@playwright/test";

import {
  buildChatUrl,
  createNetworkRecorder,
  requireChatTarget
} from "./helpers";

test.describe("chat regression smoke", () => {
  test.beforeEach(() => {
    requireChatTarget();
  });

  test("preserves agent query while switching session tabs", async ({ page }) => {
    const recorder = createNetworkRecorder(page);
    const expectedAgent = process.env.DESKCUE_E2E_AGENT_ID ?? "";

    await page.goto(buildChatUrl());
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");

    for (const tab of ["Activity", "Debug", "Diff", "Preview", "Chat"]) {
      await page.getByRole("tab", { name: tab }).click();
      expect(new URL(page.url()).searchParams.get("agent")).toBe(expectedAgent);
    }

    const staleAgent = process.env.DESKCUE_E2E_STALE_AGENT_ID;
    if (staleAgent) {
      expect(recorder.responses.some((response) => response.url.includes(encodeURIComponent(staleAgent)))).toBe(false);
    }
  });

  test("expands chat activity without loading full transcript view", async ({ page }) => {
    const recorder = createNetworkRecorder(page);

    await page.goto(buildChatUrl());
    const firstActivity = page.getByRole("button", { name: /^(Details|Tools)/ }).first();
    test.skip(await firstActivity.count() === 0, "No activity group is visible in this chat fixture.");
    await firstActivity.click();
    await page.waitForTimeout(1_000);

    const activityResponses = recorder.responses.filter((response) =>
      response.url.includes("/transcript-entries")
    );
    expect(activityResponses.length).toBeGreaterThan(0);
    expect(
      recorder.responses.some((response) =>
        response.url.includes("/transcript-view") && response.status !== 304
      )
    ).toBe(false);
  });

  test("keeps the chat pinned after switching away and back", async ({ page }) => {
    const recorder = createNetworkRecorder(page);

    await page.goto(buildChatUrl());
    const chatThread = page.locator('[class*="chatThread"]').first();
    await expect(chatThread).toBeVisible();
    await chatThread.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    recorder.clear();

    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(chatThread).toBeHidden();
    await expect(page.getByRole("heading", { name: "Chat activity" })).toBeVisible();

    await page.getByRole("tab", { name: "Chat" }).click();
    await expect(chatThread).toBeVisible();

    const bottomDelta = await chatThread.evaluate((element) =>
      Math.round(element.scrollHeight - element.clientHeight - element.scrollTop)
    );
    expect(bottomDelta).toBeLessThanOrEqual(2);
    expect(
      recorder.responses.some((response) =>
        response.url.includes("/transcript-view") && response.status !== 304
      )
    ).toBe(false);
  });
});
