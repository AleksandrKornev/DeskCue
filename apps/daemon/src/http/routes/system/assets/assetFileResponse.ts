import type express from "express";
import type { BigIntStats } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export type LocalAssetFileIdentity = {
  deviceId: bigint;
  inodeId: bigint;
};

function normalizeComparablePath(filePath: string) {
  const normalizedPath = path.resolve(filePath);

  return process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
}

function readFileIdentity(stats: BigIntStats): LocalAssetFileIdentity {
  return {
    deviceId: stats.dev,
    inodeId: stats.ino
  };
}

function hasSameFileIdentity(
  openedStats: BigIntStats,
  expectedIdentity: LocalAssetFileIdentity
) {
  return openedStats.ino !== 0n &&
    openedStats.dev === expectedIdentity.deviceId &&
    openedStats.ino === expectedIdentity.inodeId;
}

async function isOpenedAuthorizedFile(
  normalizedPath: string,
  openedStats: BigIntStats
) {
  const [currentCanonicalPath, currentStats] = await Promise.all([
    realpath(normalizedPath),
    stat(normalizedPath, { bigint: true })
  ]);

  return normalizeComparablePath(currentCanonicalPath) === normalizeComparablePath(normalizedPath) &&
    hasSameFileIdentity(openedStats, readFileIdentity(currentStats));
}

export async function readLocalAssetFileIdentity(normalizedPath: string) {
  let fileHandle;

  try {
    fileHandle = await open(normalizedPath, "r");
    const stats = await fileHandle.stat({ bigint: true });

    if (!stats.isFile() || !(await isOpenedAuthorizedFile(normalizedPath, stats))) return null;

    return readFileIdentity(stats);
  } catch {
    return null;
  } finally {
    await fileHandle?.close();
  }
}

export async function sendLocalAssetFile(
  response: express.Response,
  normalizedPath: string,
  download: boolean,
  maxBytes?: number,
  expectedIdentity?: LocalAssetFileIdentity
) {
  let fileHandle;

  try {
    fileHandle = await open(normalizedPath, "r");
    const stats = await fileHandle.stat({ bigint: true });

    if (!stats.isFile()) {
      response.status(404).json({ error: "Local asset not found." });
      return;
    }

    if (!(await isOpenedAuthorizedFile(normalizedPath, stats))) {
      response.status(403).json({
        error: "The local asset changed after it was authorized. Open it again from DeskCue."
      });
      return;
    }

    if (expectedIdentity && !hasSameFileIdentity(stats, expectedIdentity)) {
      response.status(403).json({
        error: "The local asset changed after this link was created. Open it again from DeskCue."
      });
      return;
    }

    if (maxBytes !== undefined && stats.size > BigInt(maxBytes)) {
      response.status(413).json({
        error: "Local asset exceeds this preview ticket's byte limit."
      });
      return;
    }

    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Length", stats.size.toString());

    if (download || path.extname(normalizedPath).toLowerCase() === ".svg") {
      response.attachment(path.basename(normalizedPath));
    } else {
      response.type(normalizedPath);
    }

    if (stats.size === 0n) {
      response.end();
      return;
    }

    const fileStream = fileHandle.createReadStream({
      autoClose: false,
      end: Number(stats.size - 1n),
      start: 0
    });

    await pipeline(fileStream, response);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }

    response.status(404).json({ error: "Local asset not found." });
  } finally {
    await fileHandle?.close();
  }
}

export function sendExpiredAssetTicketResponse(
  request: express.Request,
  response: express.Response
) {
  const message = "This temporary DeskCue file link expired. Open the asset again from DeskCue.";

  if (request.accepts(["html", "json"]) === "html") {
    response
      .status(404)
      .type("html")
      .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DeskCue file link expired</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #111216;
      color: #f3eee5;
      font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: min(420px, calc(100vw - 48px));
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      background: #18191f;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 20px;
    }

    p {
      margin: 0;
      color: #b9c2d8;
    }
  </style>
</head>
<body>
  <main>
    <h1>File link expired</h1>
    <p>${message}</p>
  </main>
</body>
</html>`);
    return;
  }

  response.status(404).json({
    error: message
  });
}
