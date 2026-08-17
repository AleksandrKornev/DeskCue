import type { LocalLlmChatDetail, RuntimeSummary } from "@deskcue/protocol";
import type { LmStudioInstalledModel } from "@api/endpoint/dashboard/endpoints";
import type {
  LocalLlmHistoryStream,
  LocalLlmProtectedRecordIds
} from "@modules/localLlmChats/managedSession/types";

import type { DetailMutationToken, DetailRefreshState } from "./types";

export function createLocalLlmDetailRefreshState(
  chatId: string
): DetailRefreshState {
  return {
    chatId,
    inFlight: false,
    mutationInFlight: false,
    mutationRevision: 0
  };
}

export function canApplyLocalLlmRefresh(
  state: DetailRefreshState,
  expectedState: DetailRefreshState,
  mutationRevision: number
) {
  return state === expectedState &&
    !state.mutationInFlight &&
    state.mutationRevision === mutationRevision;
}

export function canCommitLocalLlmMutation(
  state: DetailRefreshState,
  token: DetailMutationToken
) {
  return state === token.state && state.mutationRevision === token.revision;
}

export function readLocalLlmError(error: unknown) {
  return error instanceof Error ? error.message : "Local chat request failed";
}

export function rememberLoadedHistoryRecordIds(
  target: LocalLlmProtectedRecordIds,
  streams: LocalLlmHistoryStream[],
  detail: LocalLlmChatDetail
) {
  for (const stream of streams) {
    const current = new Set(target[stream] ?? []);
    for (const record of detail[stream]) {
      current.add(record.id);
    }
    target[stream] = current;
  }
}

export function estimateLocalLlmHistoryPageBytes(
  streams: LocalLlmHistoryStream[],
  detail: LocalLlmChatDetail
) {
  try {
    return streams.reduce(
      (total, stream) => total + JSON.stringify(detail[stream]).length * 2,
      0
    );
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function getLmStudioPromptBlockReason(
  runtimeId: LocalLlmChatDetail["runtimeId"] | undefined,
  runtime: RuntimeSummary | null
) {
  if (runtimeId !== "lm-studio") return null;
  if (!runtime?.running) return "server_off" as const;
  if (runtime.loadedModelCount === 0) return "model_unloaded" as const;
  return null;
}

export function findMatchingLmStudioModel(
  models: readonly LmStudioInstalledModel[],
  savedModel: string
) {
  return models.find((model) =>
    model.modelKey === savedModel ||
    model.path === savedModel ||
    model.displayName === savedModel
  ) ?? null;
}
