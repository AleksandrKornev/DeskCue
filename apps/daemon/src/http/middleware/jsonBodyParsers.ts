import express from "express";
import type { Express } from "express";

export const DEFAULT_JSON_BODY_LIMIT = "512kb";
export const LOCAL_LLM_JSON_BODY_LIMIT = "1mb";
export const LM_STUDIO_IMPORT_JSON_BODY_LIMIT = "18mb";
export const LM_STUDIO_IMPORT_MAX_ENVELOPE_BYTES = 18 * 1024 * 1024;

const LM_STUDIO_IMPORT_PATH = "/api/local-llm/chats/import/lm-studio-desktop";
let activeLmStudioImports = 0;

function readContentLength(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : LM_STUDIO_IMPORT_MAX_ENVELOPE_BYTES + 1;
}

export function installJsonBodyParsers(app: Express) {
  // The domain validator still caps imported LM Studio content at 8 MiB. The
  // The envelope allows every byte in an 8 MiB export to be JSON-escaped as a
  // two-byte quote/backslash sequence, plus bounded metadata. Control-heavy
  // synthetic inputs that require \uXXXX expansion are rejected at the edge.
  app.use(LM_STUDIO_IMPORT_PATH, (request, response, next) => {
    const contentLength = readContentLength(request.headers["content-length"]);
    if (contentLength !== null && contentLength > LM_STUDIO_IMPORT_MAX_ENVELOPE_BYTES) {
      response.status(413).json({ error: "LM Studio import envelope is too large." });
      return;
    }
    if (activeLmStudioImports >= 1) {
      response.setHeader("Retry-After", "1");
      response.status(429).json({ error: "Another LM Studio import is already being processed." });
      return;
    }

    activeLmStudioImports += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeLmStudioImports = Math.max(0, activeLmStudioImports - 1);
    };
    response.once("finish", release);
    response.once("close", release);
    next();
  });
  app.use(LM_STUDIO_IMPORT_PATH, express.json({ limit: LM_STUDIO_IMPORT_JSON_BODY_LIMIT }));
  // Local prompts may reach the 512 KiB storage limit plus their JSON envelope.
  app.use("/api/local-llm", express.json({ limit: LOCAL_LLM_JSON_BODY_LIMIT }));
  app.use(express.json({ limit: DEFAULT_JSON_BODY_LIMIT }));
}
