import http from "node:http";

import type { PreviewCandidate } from "@deskcue/protocol";

import { PREVIEW_LOOPBACK_HOSTNAME } from "./previewLoopback.ts";

export const COMMON_PREVIEW_PORTS = [3000, 4173, 4200, 5173, 5174, 8000, 8080] as const;
const PREVIEW_PROBE_TIMEOUT_MS = 600;
const PREVIEW_PROBE_CONCURRENCY = 3;

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
