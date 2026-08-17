import type { Page, Response } from "@playwright/test";
import { expect, test } from "@playwright/test";

export const e2eBaseUrl = process.env.DESKCUE_E2E_BASE_URL ?? "http://127.0.0.1:4100";

export type ResourceTimingNetworkSummary = {
  apiDecoded: number;
  apiEncoded: number;
  apiTransfer: number;
  assetTransfer: number;
  byPath: Record<string, ResourceTimingPathSummary>;
  resourceCount: number;
  totalDecoded: number;
  totalEncoded: number;
  totalTransfer: number;
};

export type ResourceTimingPathSummary = {
  count: number;
  decodedBodySize: number;
  encodedBodySize: number;
  transferSize: number;
};

export function requireE2eBaseUrl() {
  test.skip(
    !process.env.DESKCUE_E2E_BASE_URL,
    "Set DESKCUE_E2E_BASE_URL to run this optional test against a reachable DeskCue instance."
  );
}

export function requireChatTarget() {
  requireE2eBaseUrl();
  test.skip(
    !process.env.DESKCUE_E2E_SESSION_ID || !process.env.DESKCUE_E2E_AGENT_ID,
    "Set DESKCUE_E2E_SESSION_ID and DESKCUE_E2E_AGENT_ID for chat e2e smoke tests."
  );
}

export function requireAgentTarget() {
  requireE2eBaseUrl();
  test.skip(
    !process.env.DESKCUE_E2E_AGENT_ID,
    "Set DESKCUE_E2E_AGENT_ID for source-agent chat e2e smoke tests."
  );
}

export function buildChatUrl(tab = "overview") {
  return `/sessions/${encodeURIComponent(process.env.DESKCUE_E2E_SESSION_ID ?? "")}/${tab}?agent=${encodeURIComponent(process.env.DESKCUE_E2E_AGENT_ID ?? "")}`;
}

export function buildActiveAgentUrl(tab = "overview") {
  const agentQuery = `agent=${encodeURIComponent(process.env.DESKCUE_E2E_AGENT_ID ?? "")}`;
  const sessionId = process.env.DESKCUE_E2E_SESSION_ID;
  if (sessionId) {
    return `/sessions/${encodeURIComponent(sessionId)}/${tab}?${agentQuery}`;
  }

  return `/?${agentQuery}`;
}

export function createNetworkRecorder(page: Page) {
  const responses: Array<{
    bytes: number;
    status: number;
    url: string;
  }> = [];

  page.on("response", async (response: Response) => {
    const url = response.url();
    if (!url.includes("/api/")) {
      return;
    }

    let bytes = Number(response.headers()["content-length"] ?? 0);
    if (!Number.isFinite(bytes) || bytes <= 0) {
      try {
        bytes = (await response.body()).byteLength;
      } catch {
        bytes = 0;
      }
    }

    responses.push({
      bytes,
      status: response.status(),
      url
    });
  });

  return {
    clear: () => {
      responses.splice(0);
    },
    responses,
    totalBytes: () => responses.reduce((total, response) => total + response.bytes, 0)
  };
}

export async function clearResourceTiming(page: Page) {
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10_000);
    performance.clearResourceTimings();
  });
}

export async function readResourceTimingNetworkSummary(
  page: Page
): Promise<ResourceTimingNetworkSummary> {
  return page.evaluate(() => {
    type PathSummary = {
      count: number;
      decodedBodySize: number;
      encodedBodySize: number;
      transferSize: number;
    };
    const byPath: Record<string, PathSummary> = {};
    const summary = {
      apiDecoded: 0,
      apiEncoded: 0,
      apiTransfer: 0,
      assetTransfer: 0,
      byPath,
      resourceCount: 0,
      totalDecoded: 0,
      totalEncoded: 0,
      totalTransfer: 0
    };

    const normalizePath = (url: string) => {
      const parsed = new URL(url, window.location.href);
      return parsed.pathname
        .replace(/\/api\/agents\/sessions\/[^/]+/g, "/api/agents/sessions/:id")
        .replace(/\/api\/sessions\/[^/]+/g, "/api/sessions/:id")
        .replace(/\/sessions\/[^/]+/g, "/sessions/:id");
    };

    const entries = performance
      .getEntriesByType("resource")
      .filter((entry): entry is PerformanceResourceTiming =>
        entry instanceof PerformanceResourceTiming
      );

    for (const entry of entries) {
      summary.resourceCount += 1;
      summary.totalTransfer += entry.transferSize;
      summary.totalEncoded += entry.encodedBodySize;
      summary.totalDecoded += entry.decodedBodySize;

      const parsed = new URL(entry.name, window.location.href);
      if (parsed.pathname.startsWith("/api/")) {
        summary.apiTransfer += entry.transferSize;
        summary.apiEncoded += entry.encodedBodySize;
        summary.apiDecoded += entry.decodedBodySize;
      } else {
        summary.assetTransfer += entry.transferSize;
      }

      const key = normalizePath(entry.name);
      const pathSummary = byPath[key] ?? {
        count: 0,
        decodedBodySize: 0,
        encodedBodySize: 0,
        transferSize: 0
      };
      pathSummary.count += 1;
      pathSummary.transferSize += entry.transferSize;
      pathSummary.encodedBodySize += entry.encodedBodySize;
      pathSummary.decodedBodySize += entry.decodedBodySize;
      byPath[key] = pathSummary;
    }

    return summary;
  });
}

export async function expectNoConsoleProblems(page: Page) {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  });

  await page.waitForTimeout(500);
  expect(messages).toEqual([]);
}
