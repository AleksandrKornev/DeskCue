import type express from "express";

import {
  parseCreateLocalLlmChatInput,
  parseSaveLocalLlmPendingPromptInput,
  parseSendLocalLlmChatMessageInput,
  parseUpdateLocalLlmChatAgentModeInput,
  parseUpdateLocalLlmChatModelInput,
  parseUpdateLocalLlmChatPreviewInput,
  parseUpdateLocalLlmChatWorkspaceInput
} from "@deskcue/protocol";
import type { PreviewViewport } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import type { LocalLlmChatService } from "#localLlmChats/chat/localLlmChatService";
import type { LocalLlmChatHistoryPageMode } from "#localLlmChats/storage/localLlmChatLibrary";

import { readProtocolPayload } from "../../middleware/validators.ts";

type InstallLocalLlmChatRoutesOptions = {
  localLlmChats: LocalLlmChatService;
};

function readMessageInput(value: unknown) {
  return readProtocolPayload(() => parseSendLocalLlmChatMessageInput(value));
}

function readObject(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new AppError("invalid_input", "Expected a request payload.");
  }
  return value as Record<string, unknown>;
}

function readActionDecision(value: unknown): "approve" | "reject" {
  const decision = readObject(value).decision;
  if (decision !== "approve" && decision !== "reject") {
    throw new AppError("invalid_input", "Choose approve or reject for the local agent action.");
  }
  return decision;
}

function readPreviewViewport(value: unknown): PreviewViewport {
  const viewport = readObject(value).viewport;
  if (viewport !== "desktop" && viewport !== "mobile") {
    throw new AppError("invalid_input", "Choose a valid preview viewport.");
  }
  return viewport;
}

function readUpdatePreviewInput(value: unknown) {
  return readProtocolPayload(() => parseUpdateLocalLlmChatPreviewInput(value));
}

function readSavePendingPromptInput(value: unknown) {
  return readProtocolPayload(() => parseSaveLocalLlmPendingPromptInput(value));
}

function readUpdateModelInput(value: unknown) {
  return readProtocolPayload(() => parseUpdateLocalLlmChatModelInput(value));
}

function readUpdateAgentModeInput(value: unknown) {
  return readProtocolPayload(() => parseUpdateLocalLlmChatAgentModeInput(value));
}

function readUpdateWorkspaceInput(value: unknown) {
  return readProtocolPayload(() => parseUpdateLocalLlmChatWorkspaceInput(value));
}

function readHistoryPageMode(value: unknown): LocalLlmChatHistoryPageMode {
  return value === "initial" || value === "live" ? value : "history";
}

function readHistoryCursor(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

function readNonEmptyString(value: unknown, message: string, maxLength = 300) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("invalid_input", message);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new AppError("invalid_input", `Input exceeds the ${maxLength.toLocaleString("en-US")}-character limit.`);
  }
  return normalized;
}

function readImportInput(value: unknown) {
  const body = readObject(value);
  return {
    content: readNonEmptyString(body.content, "Choose an LM Studio .conversation.json export.", 8 * 1024 * 1024),
    model: readNonEmptyString(body.model, "Choose a local model before importing a chat."),
    sourceFileName: readNonEmptyString(body.sourceFileName, "Choose an LM Studio export file.", 300)
  };
}

function readCreateChatInput(value: unknown) {
  return readProtocolPayload(() => parseCreateLocalLlmChatInput(value));
}

export function installLocalLlmChatRoutes(
  app: express.Express,
  { localLlmChats }: InstallLocalLlmChatRoutesOptions
) {
  app.get("/api/local-llm/chats", async (_request, response, next) => {
    try {
      response.json({ chats: await localLlmChats.listChats() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/local-llm/chats", async (request, response, next) => {
    try {
      const chat = await localLlmChats.createChat(readCreateChatInput(request.body));
      response.status(201).json(chat);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/local-llm/chats/import/lm-studio-desktop", async (request, response, next) => {
    try {
      response.status(201).json(await localLlmChats.importLmStudioDesktopChat(readImportInput(request.body)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/local-llm/chats/:chatId", async (request, response, next) => {
    try {
      response.json(await localLlmChats.getChat(request.params.chatId, {
        changeSets: readHistoryCursor(request.query.changeSets),
        events: readHistoryCursor(request.query.events),
        messages: readHistoryCursor(request.query.messages)
      }, readHistoryPageMode(request.query.tail)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/local-llm/chats/:chatId/change-sets/:changeSetId", async (request, response, next) => {
    try {
      response.json(await localLlmChats.getChangeSetDiff(request.params.chatId, request.params.changeSetId));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/local-llm/chats/:chatId", async (request, response, next) => {
    try {
      response.json(
        await localLlmChats.updateWorkspace(
          request.params.chatId,
          readUpdateWorkspaceInput(request.body).workspaceId
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/local-llm/chats/:chatId/agent-mode", async (request, response, next) => {
    try {
      response.json(
        await localLlmChats.updateAgentMode(
          request.params.chatId,
          readUpdateAgentModeInput(request.body).agentMode
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/local-llm/chats/:chatId/model", async (request, response, next) => {
    try {
      response.json(
        await localLlmChats.updateModel(
          request.params.chatId,
          readUpdateModelInput(request.body).model
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/local-llm/chats/:chatId/pending-lm-studio-prompt", async (request, response, next) => {
    try {
      response.json(await localLlmChats.savePendingLmStudioPrompt(
        request.params.chatId,
        readSavePendingPromptInput(request.body).text
      ));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/local-llm/chats/:chatId/pending-lm-studio-prompt", async (request, response, next) => {
    try {
      response.json(await localLlmChats.discardPendingLmStudioPrompt(request.params.chatId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/local-llm/chats/:chatId/preview", async (request, response, next) => {
    try {
      const input = readUpdatePreviewInput(request.body);
      response.json(await localLlmChats.updatePreviewPort(
        request.params.chatId,
        input.port,
        input.networkMode
      ));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/local-llm/chats/:chatId/preview/artifacts", async (request, response, next) => {
    try {
      response.status(201).json(await localLlmChats.capturePreviewArtifact(
        request.params.chatId,
        readPreviewViewport(request.body)
      ));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/local-llm/chats/:chatId/git/refresh", async (request, response, next) => {
    try {
      response.json(await localLlmChats.refreshGit(request.params.chatId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/local-llm/chats/:chatId/actions/:actionRequestId", async (request, response, next) => {
    try {
      response.json(await localLlmChats.resolveActionRequest(
        request.params.chatId,
        request.params.actionRequestId,
        readActionDecision(request.body)
      ));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/local-llm/chats/:chatId/messages", async (request, response, next) => {
    try {
      response.json(
        await localLlmChats.sendMessage(request.params.chatId, readMessageInput(request.body).text)
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/local-llm/chats/:chatId/interrupt", async (request, response, next) => {
    try {
      response.json(await localLlmChats.interrupt(request.params.chatId));
    } catch (error) {
      next(error);
    }
  });
}
