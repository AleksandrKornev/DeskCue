import type express from "express";
import type { BigIntStats } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const ACTIVE_DOCUMENT_EXTENSIONS = new Set([
  ".htm",
  ".html",
  ".mht",
  ".mhtml",
  ".shtml",
  ".svg",
  ".svgz",
  ".xht",
  ".xhtml",
  ".xml",
  ".xsl",
  ".xslt"
]);

export type LocalAssetFileIdentity = {
  deviceId: bigint;
  inodeId: bigint;
};

export type LocalAssetByteRange = {
  end: bigint;
  start: bigint;
};

export function resolveLocalAssetByteRange(
  rangeHeader: string | undefined,
  size: bigint
): LocalAssetByteRange | "unsatisfiable" | null {
  if (!rangeHeader) return null;

  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/iu);

  if (!match || size === 0n) return "unsatisfiable";

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";

  if (!startText && !endText) return "unsatisfiable";

  if (!startText) {
    const suffixLength = BigInt(endText);

    if (suffixLength <= 0n) return "unsatisfiable";

    return {
      end: size - 1n,
      start: suffixLength >= size ? 0n : size - suffixLength
    };
  }

  const start = BigInt(startText);

  if (start >= size) return "unsatisfiable";

  const requestedEnd = endText ? BigInt(endText) : size - 1n;

  if (requestedEnd < start) return "unsatisfiable";

  return {
    end: requestedEnd >= size ? size - 1n : requestedEnd,
    start
  };
}

function normalizeComparablePath(filePath: string) {
  const normalizedPath = path.resolve(filePath);

  return process.platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
}

function shouldForceAssetDownload(normalizedPath: string) {
  return ACTIVE_DOCUMENT_EXTENSIONS.has(path.extname(normalizedPath).toLowerCase());
}

function hasActiveAssetContentType(contentType: number | string | string[] | undefined) {
  if (typeof contentType !== "string") return false;

  const mimeType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  return mimeType === "text/html" ||
    mimeType === "text/xml" ||
    mimeType === "application/xml" ||
    mimeType.endsWith("+xml");
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
  expectedIdentity?: LocalAssetFileIdentity,
  rangeHeader?: string
) {
  let fileHandle;

  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Referrer-Policy", "no-referrer");

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

    const range = resolveLocalAssetByteRange(rangeHeader, stats.size);

    response.setHeader("Accept-Ranges", "bytes");
    if (range === "unsatisfiable") {
      response.setHeader("Content-Range", `bytes */${stats.size}`);
      response.status(416).end();
      return;
    }

    const start = range?.start ?? 0n;
    const end = range?.end ?? stats.size - 1n;
    const contentLength = stats.size === 0n ? 0n : end - start + 1n;

    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Length", contentLength.toString());

    if (range) {
      response.setHeader("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      response.status(206);
    }

    response.type(normalizedPath);
    const forceDownload = download ||
      shouldForceAssetDownload(normalizedPath) ||
      hasActiveAssetContentType(response.getHeader("Content-Type"));

    if (forceDownload) {
      response.attachment(path.basename(normalizedPath));
    }

    if (stats.size === 0n) {
      response.end();
      return;
    }

    const fileStream = fileHandle.createReadStream({
      autoClose: false,
      end: Number(end),
      start: Number(start)
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
