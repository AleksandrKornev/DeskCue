import express from "express";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { LocalLlmChatService } from "#localLlmChats/chat/localLlmChatService";

import { errorHandler } from "./errorHandler.ts";
import { installJsonBodyParsers, LM_STUDIO_IMPORT_MAX_ENVELOPE_BYTES } from "./jsonBodyParsers.ts";
import { installLocalLlmChatRoutes } from "../routes/agents/localLlmChatRoutes.ts";

function echoBodyLength(
  request: express.Request,
  response: express.Response
) {
  response.json({ length: String(request.body?.content ?? "").length });
}

test("keeps large JSON allowances scoped to Local LLM and its import route", async () => {
  const app = express();
  installJsonBodyParsers(app);
  app.post("/api/local-llm/body-limit-test", echoBodyLength);
  let importedContentLength = 0;
  installLocalLlmChatRoutes(app, {
    localLlmChats: {
      async importLmStudioDesktopChat(input: { content: string }) {
        importedContentLength = input.content.length;
        return { id: "imported" };
      }
    } as unknown as LocalLlmChatService
  });
  app.post("/api/settings-test", echoBodyLength);
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const post = (path: string, content: string, extra: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    body: JSON.stringify({ content, ...extra }),
    headers: { "content-type": "application/json" },
    method: "POST"
  });

  try {
    const normalResponse = await post("/api/settings-test", "x".repeat(600 * 1024));
    assert.equal(normalResponse.status, 413);

    const localResponse = await post(
      "/api/local-llm/body-limit-test",
      "x".repeat(600 * 1024)
    );
    assert.equal(localResponse.status, 200);

    const escapedImport = "\\".repeat(8 * 1024 * 1024 - 1024);
    const importResponse = await post(
      "/api/local-llm/chats/import/lm-studio-desktop",
      escapedImport,
      { model: "local-model", sourceFileName: "chat.conversation.json" }
    );
    assert.equal(importResponse.status, 201);
    assert.equal(importedContentLength, escapedImport.length);

    const oversizedDomainImport = await post(
      "/api/local-llm/chats/import/lm-studio-desktop",
      "\\".repeat(8 * 1024 * 1024 + 1),
      { model: "local-model", sourceFileName: "chat.conversation.json" }
    );
    assert.equal(oversizedDomainImport.status, 400);

    const earlyRejectedStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({
        headers: {
          "content-length": String(LM_STUDIO_IMPORT_MAX_ENVELOPE_BYTES + 1),
          "content-type": "application/json"
        },
        host: "127.0.0.1",
        method: "POST",
        path: "/api/local-llm/chats/import/lm-studio-desktop",
        port
      }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      });
      request.once("error", reject);
      request.end();
    });
    assert.equal(earlyRejectedStatus, 413);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
  }
});
