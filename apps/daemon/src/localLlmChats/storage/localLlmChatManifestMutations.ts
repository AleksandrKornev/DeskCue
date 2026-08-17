import { randomUUID } from "node:crypto";

import type {
  LocalLlmActionRequest,
  PreviewArtifact,
  PreviewNetworkMode,
  PreviewViewport
} from "@deskcue/protocol";
import { AppError } from "#application/errors";

import type { LocalLlmChatManifestRepository } from "./localLlmChatManifestRepository.ts";
import type { LocalLlmChatManifest } from "./localLlmChatStorageSchema.ts";
import { emptyLocalLlmPreview } from "./localLlmChatStorageSchema.ts";
import type { LocalLlmToolRequest } from "../tools/localLlmToolExecutor.ts";

function upsertActionRequest(
  requests: LocalLlmActionRequest[] | undefined,
  actionRequest: LocalLlmActionRequest
) {
  const next = [...(requests ?? [])];
  const index = next.findIndex((item) => item.id === actionRequest.id);
  if (index === -1) next.push(actionRequest);
  else next[index] = actionRequest;
  return next;
}

function replacePendingToolRequest(
  requests: LocalLlmChatManifest["pendingToolRequests"],
  actionRequestId: string,
  request: LocalLlmToolRequest
) {
  return [
    ...(requests ?? []).filter((item) => item.actionRequestId !== actionRequestId),
    { actionRequestId, request }
  ];
}

/** Manifest-only operations kept outside the append-only history library. */
export class LocalLlmChatManifestMutations {
  constructor(private readonly manifests: LocalLlmChatManifestRepository) {}

  async setPreviewPort(
    chatId: string,
    port: number | null,
    networkMode?: PreviewNetworkMode
  ) {
    await this.manifests.update(chatId, (manifest) => ({
      ...manifest,
      preview: port === null
        ? {
            ...emptyLocalLlmPreview(),
            networkMode: networkMode ?? manifest.preview?.networkMode ?? "device-direct"
          }
        : {
            active: true,
            artifacts: manifest.preview?.artifacts ?? [],
            networkMode: networkMode ?? manifest.preview?.networkMode ?? "device-direct",
            port,
            targetUrl: `http://127.0.0.1:${port}`
          }
    }));
  }

  async capturePreviewArtifact(chatId: string, viewport: PreviewViewport) {
    const manifest = await this.manifests.read(chatId);
    const preview = manifest.preview ?? emptyLocalLlmPreview();
    if (!preview.active || !preview.targetUrl) {
      throw new AppError("invalid_input", "Preview is not active for this local chat.");
    }
    const artifact: PreviewArtifact = {
      id: `preview-${randomUUID()}`,
      capturedAt: new Date().toISOString(),
      notes: [
        `Target: ${preview.targetUrl}`,
        `Runtime: ${manifest.runtimeId}`,
        `Model: ${manifest.model}`,
        `Workspace: ${manifest.workspace?.name ?? "not attached"}`
      ],
      source: "metadata",
      targetUrl: preview.targetUrl,
      title: `${viewport === "mobile" ? "Mobile" : "Desktop"} preview`,
      viewport
    };
    await this.manifests.update(chatId, (current) => ({
      ...current,
      preview: {
        ...(current.preview ?? preview),
        artifacts: [artifact, ...(current.preview?.artifacts ?? [])].slice(0, 20)
      }
    }));
    return artifact;
  }

  async upsertActionRequest(chatId: string, actionRequest: LocalLlmActionRequest) {
    await this.manifests.update(chatId, (manifest) => ({
      ...manifest,
      actionRequests: upsertActionRequest(manifest.actionRequests, actionRequest)
    }));
  }

  async savePendingToolRequest(
    chatId: string,
    actionRequestId: string,
    request: LocalLlmToolRequest
  ) {
    await this.manifests.update(chatId, (manifest) => ({
      ...manifest,
      pendingToolRequests: replacePendingToolRequest(
        manifest.pendingToolRequests,
        actionRequestId,
        request
      )
    }));
  }

  async takePendingToolRequest(chatId: string, actionRequestId: string) {
    const manifest = await this.manifests.read(chatId);
    return manifest.pendingToolRequests?.find(
      (item) => item.actionRequestId === actionRequestId
    )?.request ?? null;
  }

  async removePendingToolRequest(chatId: string, actionRequestId: string) {
    await this.manifests.update(chatId, (manifest) => ({
      ...manifest,
      pendingToolRequests: manifest.pendingToolRequests?.filter(
        (item) => item.actionRequestId !== actionRequestId
      ) ?? []
    }));
  }

  async saveAgentContinuation(
    chatId: string,
    continuation: NonNullable<LocalLlmChatManifest["agentContinuation"]>
  ) {
    await this.manifests.update(chatId, (manifest) => ({
      ...manifest,
      agentContinuation: continuation
    }));
  }

  async savePendingAgentAction(chatId: string, input: {
    actionRequest: LocalLlmActionRequest;
    continuation: NonNullable<LocalLlmChatManifest["agentContinuation"]>;
    request: LocalLlmToolRequest;
  }) {
    await this.manifests.update(chatId, (manifest) => ({
      ...manifest,
      actionRequests: upsertActionRequest(manifest.actionRequests, input.actionRequest),
      agentContinuation: input.continuation,
      pendingToolRequests: replacePendingToolRequest(
        manifest.pendingToolRequests,
        input.actionRequest.id,
        input.request
      ),
      updatedAt: input.actionRequest.requestedAt
    }));
  }
}
