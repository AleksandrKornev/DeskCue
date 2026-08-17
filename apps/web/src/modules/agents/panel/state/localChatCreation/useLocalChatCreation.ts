import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import type { LocalLlmRuntimeId } from "@deskcue/protocol";

import { DEFAULT_LOCAL_CHAT_RUNTIME_ID } from "./constants";
import type {
  LocalChatCreationController,
  UseLocalChatCreationOptions
} from "./types";
import { useConnectionEpoch } from "./useConnectionEpoch";
import { useLocalChatSubmission } from "./useLocalChatSubmission";
import { useLocalRuntimeCatalog } from "./useLocalRuntimeCatalog";

export function useLocalChatCreation({
  defaultRuntimeId = DEFAULT_LOCAL_CHAT_RUNTIME_ID,
  onCreated
}: UseLocalChatCreationOptions): LocalChatCreationController {
  const [isOpen, setIsOpen] = useState(false);
  const [runtimeId, setRuntimeIdState] = useState(defaultRuntimeId);
  const [selectedModelKey, setSelectedModelKeyState] = useState("");
  const [workspaceId, setWorkspaceIdState] = useState("");
  const connectionEpoch = useConnectionEpoch();
  const {
    cancel: cancelCatalog,
    retry: retryCatalogRequest,
    state: catalog
  } = useLocalRuntimeCatalog({
    active: isOpen,
    connectionEpoch,
    runtimeId
  });
  const {
    cancel: cancelSubmission,
    clearError: clearSubmissionError,
    create: submit,
    error,
    submitting
  } = useLocalChatSubmission({ connectionEpoch });

  const resetSelection = useCallback(() => {
    setSelectedModelKeyState("");
    setWorkspaceIdState("");
  }, []);

  const close = useCallback(() => {
    cancelCatalog();
    cancelSubmission();
    resetSelection();
    setRuntimeIdState(defaultRuntimeId);
    setIsOpen(false);
  }, [cancelCatalog, cancelSubmission, defaultRuntimeId, resetSelection]);

  const open = useCallback(() => {
    cancelCatalog();
    cancelSubmission();
    resetSelection();
    setRuntimeIdState(defaultRuntimeId);
    retryCatalogRequest();
    setIsOpen(true);
  }, [
    cancelCatalog,
    cancelSubmission,
    defaultRuntimeId,
    resetSelection,
    retryCatalogRequest
  ]);

  const setRuntimeId = useCallback((nextRuntimeId: LocalLlmRuntimeId) => {
    if (runtimeId === nextRuntimeId) {
      return;
    }
    cancelCatalog();
    cancelSubmission();
    setSelectedModelKeyState("");
    setRuntimeIdState(nextRuntimeId);
    retryCatalogRequest();
  }, [cancelCatalog, cancelSubmission, retryCatalogRequest, runtimeId]);

  const setSelectedModelKey = useCallback((modelKey: string) => {
    setSelectedModelKeyState(modelKey);
    clearSubmissionError();
  }, [clearSubmissionError]);

  const setWorkspaceId = useCallback((nextWorkspaceId: string) => {
    setWorkspaceIdState(nextWorkspaceId);
    clearSubmissionError();
  }, [clearSubmissionError]);

  const retryCatalog = useCallback(() => {
    setSelectedModelKeyState("");
    clearSubmissionError();
    retryCatalogRequest();
  }, [clearSubmissionError, retryCatalogRequest]);

  const create = useCallback(async () => {
    const model = selectedModelKey.trim();
    if (
      !isOpen ||
      catalog.status !== "ready" ||
      submitting ||
      !catalog.models.some((installedModel) => installedModel.modelKey === model)
    ) {
      return null;
    }

    const chat = await submit({
      model,
      runtimeId,
      workspaceId: workspaceId || null
    });
    if (!chat) {
      return null;
    }

    close();
    onCreated(chat);
    return chat;
  }, [
    catalog,
    close,
    isOpen,
    onCreated,
    runtimeId,
    selectedModelKey,
    submit,
    submitting,
    workspaceId
  ]);

  useEffect(() => {
    if (!isOpen) {
      setRuntimeIdState(defaultRuntimeId);
    }
  }, [defaultRuntimeId, isOpen]);

  useEffect(() => {
    resetSelection();
  }, [connectionEpoch, resetSelection]);

  const canCreate = useMemo(
    () => isOpen &&
      catalog.status === "ready" &&
      !submitting &&
      catalog.models.some(
        (model) => model.modelKey === selectedModelKey.trim()
      ),
    [catalog, isOpen, selectedModelKey, submitting]
  );

  return {
    canCreate,
    catalog,
    close,
    create,
    error,
    isOpen,
    open,
    retryCatalog,
    runtimeId,
    selectedModelKey,
    setRuntimeId,
    setSelectedModelKey,
    setWorkspaceId,
    submitting,
    workspaceId
  };
}
