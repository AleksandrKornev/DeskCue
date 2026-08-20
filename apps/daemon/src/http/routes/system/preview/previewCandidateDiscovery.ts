import http from "node:http";

import type { PreviewCandidate } from "@deskcue/protocol";

import { PREVIEW_LOOPBACK_HOSTNAME } from "./previewLoopback.ts";

export const COMMON_PREVIEW_PORTS = [3000, 4173, 4200, 5173, 5174, 8000, 8080] as const;
const PREVIEW_PROBE_TIMEOUT_MS = 600;
const PREVIEW_PROBE_CONCURRENCY = 3;
const PREVIEW_READINESS_TIMEOUT_MS = 5_000;
const PREVIEW_READINESS_RETRY_DELAY_MS = 150;

type PreviewReadinessOptions = {
  delay?: (durationMs: number) => Promise<void>;
  now?: () => number;
  probe?: (port: number) => Promise<boolean>;
  retryDelayMs?: number;
  timeoutMs?: number;
};

function delay(durationMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

export function probePreviewPort(port: number) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (healthy: boolean) => {
      if (settled) return;
      settled = true;
      resolve(healthy);
    };
    const request = http.request({
      headers: { accept: "text/html,*/*;q=0.1" },
      host: PREVIEW_LOOPBACK_HOSTNAME,
      method: "HEAD",
      path: "/",
      port,
      timeout: PREVIEW_PROBE_TIMEOUT_MS
    }, (response) => {
      response.resume();
      finish(true);
    });
    request.once("error", () => finish(false));
    request.once("timeout", () => {
      request.destroy();
      finish(false);
    });
    request.end();
  });
}

export async function waitForPreviewPort(
  port: number,
  {
    delay: wait = delay,
    now = Date.now,
    probe = probePreviewPort,
    retryDelayMs = PREVIEW_READINESS_RETRY_DELAY_MS,
    timeoutMs = PREVIEW_READINESS_TIMEOUT_MS
  }: PreviewReadinessOptions = {}
) {
  const deadline = now() + Math.max(0, timeoutMs);
  while (true) {
    if (await probe(port)) return true;
    const remainingMs = deadline - now();
    if (remainingMs <= 0) return false;
    await wait(Math.min(Math.max(1, retryDelayMs), remainingMs));
  }
}

export async function discoverPreviewCandidates({
  configuredPort,
  excludedPort,
  ports = COMMON_PREVIEW_PORTS,
  probe = probePreviewPort
}: {
  configuredPort: number | null;
  excludedPort: number;
  ports?: readonly number[];
  probe?: (port: number) => Promise<boolean>;
}): Promise<PreviewCandidate[]> {
  const candidates = [...new Set([
    ...(configuredPort ? [configuredPort] : []),
    ...ports
  ])].filter((port) => port !== excludedPort && port >= 1 && port <= 65_535);
  const healthy = new Set<number>();
  let cursor = 0;

  await Promise.all(Array.from(
    { length: Math.min(PREVIEW_PROBE_CONCURRENCY, candidates.length) },
    async () => {
      while (cursor < candidates.length) {
        const port = candidates[cursor++];
        if (await probe(port)) healthy.add(port);
      }
    }
  ));

  return candidates
    .filter((port) => healthy.has(port))
    .map((port) => ({ configured: port === configuredPort, port }));
}
