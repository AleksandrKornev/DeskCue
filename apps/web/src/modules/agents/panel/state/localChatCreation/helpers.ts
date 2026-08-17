import type {
  LmStudioInstalledModel,
  OllamaInstalledModel
} from "@deskcue/protocol";

import type { LocalChatCreationModel } from "./types";

export function normalizeLocalChatCreationModels(
  models: Array<LmStudioInstalledModel | OllamaInstalledModel>
): LocalChatCreationModel[] {
  const uniqueModels = new Map<string, LocalChatCreationModel>();
  for (const model of models) {
    const modelKey = model.modelKey.trim();
    if (!modelKey || uniqueModels.has(modelKey)) {
      continue;
    }
    uniqueModels.set(modelKey, {
      displayName: model.displayName.trim() || modelKey,
      modelKey
    });
  }
  return Array.from(uniqueModels.values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: "base"
    })
  );
}

export function readLocalChatCreationError(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : fallbackMessage;
}
