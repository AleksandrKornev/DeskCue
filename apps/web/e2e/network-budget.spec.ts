import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  buildActiveAgentUrl,
  buildChatUrl,
  clearResourceTiming,
  createNetworkRecorder,
  readResourceTimingNetworkSummary,
  requireAgentTarget,
  requireChatTarget
} from "./helpers";

async function clickIfVisible(
  page: Page,
  role: "button" | "tab",
  name: RegExp | string
) {
  const locator = page.getByRole(role, { name }).first();
  if ((await locator.count()) === 0) {
    return;
  }

  if (!(await locator.isVisible().catch(() => false))) {
    return;
  }

  await locator.click({ timeout: 1_000 }).catch(() => undefined);
}

async function scrollActiveSurface(page: Page) {
  await page.evaluate(() => {
    const scrollable = Array.from(
      document.querySelectorAll<HTMLElement>(
        "main, [class*='chatThread'], [class*='activity'], [class*='panel']"
      )
    ).find((element) => element.scrollHeight > element.clientHeight + 24);
    if (scrollable) {
      scrollable.scrollTop = Math.min(
        scrollable.scrollHeight,
        scrollable.scrollTop + Math.max(160, scrollable.clientHeight / 2)
      );
      return;
    }

    window.scrollBy(0, Math.max(160, window.innerHeight / 2));
  });
}

async function performLiveUserAction(page: Page, index: number) {
  const actions = [
    () => clickIfVisible(page, "tab", "Activity"),
    () => clickIfVisible(page, "tab", "Debug"),
    () => clickIfVisible(page, "tab", "Diff"),
    () => clickIfVisible(page, "tab", "Preview"),
    () => clickIfVisible(page, "tab", "Chat"),
    () => clickIfVisible(page, "tab", "Tools"),
    () => clickIfVisible(page, "tab", "Chats"),
    () => clickIfVisible(page, "button", /Running/),
    () => clickIfVisible(page, "button", /Finished/),
    () => scrollActiveSurface(page)
  ];

  await actions[index % actions.length]?.();
}

test.describe("network budget smoke", () => {
  test("keeps initial chat load bounded and avoids websocket retry storms", async ({ page }) => {
    requireChatTarget();
    const recorder = createNetworkRecorder(page);
    const consoleProblems: string[] = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleProblems.push(message.text());
      }
    });

    await page.goto(buildChatUrl());
    await expect(page.getByText(/Live|Connecting|Reconnecting/).first()).toBeVisible();
    await page.waitForTimeout(3_000);

    const budgetBytes = Number(process.env.DESKCUE_E2E_INITIAL_CHAT_BYTES_BUDGET ?? 120_000);
    expect(recorder.totalBytes()).toBeLessThanOrEqual(budgetBytes);
    expect(consoleProblems.filter((message) => message.includes("WebSocket")).length).toBe(0);
    expect(
      recorder.responses.some((response) =>
        response.url.includes("/transcript-view") && response.bytes > budgetBytes
      )
    ).toBe(false);
  });

  test("keeps a live-user active chat flow within release network budgets", async ({ page }, testInfo) => {
    requireAgentTarget();
    const durationMs = Number(process.env.DESKCUE_E2E_LIVE_USER_MS ?? 0);
    test.skip(
      durationMs <= 0,
      "Set DESKCUE_E2E_LIVE_USER_MS to run the long live-user network budget."
    );
    test.setTimeout(durationMs + 60_000);

    const consoleProblems: string[] = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleProblems.push(message.text());
      }
    });

    await clearResourceTiming(page);
    await page.goto(buildActiveAgentUrl());
    await page.waitForTimeout(2_000);

    const startedAt = Date.now();
    let actionIndex = 0;
    while (Date.now() - startedAt < durationMs) {
      await performLiveUserAction(page, actionIndex);
      actionIndex += 1;
      await page.waitForTimeout(5_000);
    }

    const summary = await readResourceTimingNetworkSummary(page);
    await testInfo.attach("network-summary.json", {
      body: JSON.stringify(summary, null, 2),
      contentType: "application/json"
    });

    const apiBudgetBytes = Number(
      process.env.DESKCUE_E2E_LIVE_USER_API_BYTES_BUDGET ?? 1_000_000
    );
    const totalBudgetBytes = Number(
      process.env.DESKCUE_E2E_LIVE_USER_TOTAL_BYTES_BUDGET ?? 3_000_000
    );
    const maxTranscriptUpdateRequests = Number(
      process.env.DESKCUE_E2E_LIVE_USER_TRANSCRIPT_UPDATES_BUDGET ??
        Math.ceil(150 * (durationMs / 300_000))
    );
    const transcriptUpdates =
      summary.byPath["/api/agents/sessions/:id/transcript-updates"];

    expect(summary.apiTransfer).toBeLessThanOrEqual(apiBudgetBytes);
    expect(summary.totalTransfer).toBeLessThanOrEqual(totalBudgetBytes);
    expect(transcriptUpdates?.count ?? 0).toBeLessThanOrEqual(maxTranscriptUpdateRequests);
    expect(consoleProblems).toEqual([]);
  });
});
