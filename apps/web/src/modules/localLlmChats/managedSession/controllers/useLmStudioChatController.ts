import { useCallback, useEffect, useRef, useState } from "react";

import type { RuntimeSummary } from "@deskcue/protocol";
import { dashboardApi } from "@api/endpoint/dashboard/endpoints";
import type { LmStudioInstalledModel } from "@api/endpoint/dashboard/endpoints";
import { localLlmChatsApi } from "@api/endpoint/localLlmChats/endpoints";

import {
  findMatchingLmStudioModel,
  getLmStudioPromptBlockReason,
  readLocalLlmError
} from "./helpers";
import type { UseLmStudioChatControllerOptions } from "./types";

export function useLmStudioChatController({
  chatId,
  detail,
  mutateDetail,
  runtime,
  setError
}: UseLmStudioChatControllerOptions) {
  const [models, setModels] = useState<LmStudioInstalledModel[] | null>(null);
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [modelDialogChatId, setModelDialogChatId] = useState<string | null>(null);
  const [updatingModel, setUpdatingModel] = useState(false);
  const [preparedRuntime, setPreparedRuntime] = useState<RuntimeSummary | null>(null);
  const [starting, setStarting] = useState(false);
  const chatOwnerRef = useRef({ chatId });
  if (chatOwnerRef.current.chatId !== chatId) {
    chatOwnerRef.current = { chatId };
  }
  const modelDialogOpen = modelDialogChatId === chatId;
  const setModelDialogOpen = useCallback((open: boolean) => {
    setModelDialogChatId(open ? chatId : null);
  }, [chatId]);

  useEffect(() => {
    setPreparedRuntime(null);
  }, [runtime]);

  useEffect(() => {
    setModels(null);
    setSelectedModelKey("");
    setModelDialogOpen(false);
    setUpdatingModel(false);
    setPreparedRuntime(null);
    setStarting(false);
  }, [chatId, setModelDialogOpen]);

  useEffect(() => {
    if (
      !modelDialogOpen ||
      detail?.id !== chatId ||
      detail.runtimeId !== "lm-studio"
    ) return;
    const owner = chatOwnerRef.current;
    let active = true;
    setModels(null);
    setSelectedModelKey("");
    void dashboardApi.getLmStudioModels()
      .then(({ models: installedModels }) => {
        if (!active || chatOwnerRef.current !== owner) return;
        const matchingModel = findMatchingLmStudioModel(installedModels, detail.model);
        setModels(installedModels);
        setSelectedModelKey(matchingModel?.modelKey ?? "");
      })
      .catch((modelError: unknown) => {
        if (!active || chatOwnerRef.current !== owner) return;
        setModels([]);
        setError(readLocalLlmError(modelError));
      });
    return () => {
      active = false;
    };
  }, [chatId, detail?.id, detail?.model, detail?.runtimeId, modelDialogOpen, setError]);

  const startAndSendPendingPrompt = useCallback(async () => {
    const pendingPrompt = detail?.pendingLmStudioPrompt;
    if (!pendingPrompt || detail.id !== chatId) return;
    const owner = chatOwnerRef.current;

    setStarting(true);
    setError(null);
    try {
      if (detail.runtimeId !== "lm-studio") return;
      const modelKey = detail.model.trim();
      if (!modelKey) {
        setError("This chat does not identify an LM Studio model to load.");
        return;
      }
      const prepared = await dashboardApi.prepareLmStudioModel(modelKey);
      if (chatOwnerRef.current !== owner) return;
      const nextRuntime = prepared.runtime;
      setPreparedRuntime(nextRuntime);

      const blockReason = getLmStudioPromptBlockReason(detail.runtimeId, nextRuntime);
      if (blockReason === "server_off") {
        setError("LM Studio Local Server is still starting. Try again in a moment.");
        return;
      }
      if (blockReason === "model_unloaded") {
        setError("LM Studio did not finish loading the model for this chat.");
        return;
      }

      await mutateDetail(async () => {
        if (detail.model !== prepared.model.modelKey) {
          await localLlmChatsApi.updateModel(detail.id, { model: prepared.model.modelKey });
        }
        return localLlmChatsApi.send(detail.id, { text: pendingPrompt.text });
      });
    } catch (startError) {
      if (chatOwnerRef.current === owner) {
        setError(readLocalLlmError(startError));
      }
    } finally {
      if (chatOwnerRef.current === owner) {
        setStarting(false);
      }
    }
  }, [chatId, detail, mutateDetail, setError]);

  const discardPendingPrompt = useCallback(() => {
    if (!detail || detail.id !== chatId) return;
    const owner = chatOwnerRef.current;
    setError(null);
    void mutateDetail(() => localLlmChatsApi.discardPendingLmStudioPrompt(detail.id))
      .then(() => {
        if (chatOwnerRef.current !== owner) return;
        setModels(null);
        setSelectedModelKey("");
      })
      .catch((discardError: unknown) => {
        if (chatOwnerRef.current === owner) {
          setError(readLocalLlmError(discardError));
        }
      });
  }, [chatId, detail, mutateDetail, setError]);

  const updateModel = useCallback(async () => {
    if (
      !detail ||
      detail.id !== chatId ||
      detail.runtimeId !== "lm-studio" ||
      !selectedModelKey
    ) return;
    const owner = chatOwnerRef.current;

    setUpdatingModel(true);
    setError(null);
    try {
      await mutateDetail(() => localLlmChatsApi.updateModel(detail.id, { model: selectedModelKey }));
      if (chatOwnerRef.current === owner) {
        setModelDialogOpen(false);
      }
    } catch (modelError) {
      if (chatOwnerRef.current === owner) {
        setError(readLocalLlmError(modelError));
      }
    } finally {
      if (chatOwnerRef.current === owner) {
        setUpdatingModel(false);
      }
    }
  }, [chatId, detail, mutateDetail, selectedModelKey, setError, setModelDialogOpen]);

  return {
    activeRuntime: preparedRuntime ?? runtime,
    discardPendingPrompt,
    modelDialogOpen,
    models,
    selectedModelKey,
    setModelDialogOpen,
    setSelectedModelKey,
    startAndSendPendingPrompt,
    starting,
    updateModel,
    updatingModel
  };
}
