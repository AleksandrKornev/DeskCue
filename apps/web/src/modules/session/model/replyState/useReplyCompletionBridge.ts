import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PendingChatPrompt } from "@models/promptDelivery";
import type { ChatTranscriptEntry } from "@modules/session/types";

import { FINAL_REPLY_SYNC_BRIDGE_MS } from "./constants";
import {
  buildPromptIdentity,
  hasAssistantReplyAfterPrompt
} from "./helpers";
import type { ReplyCompletionBridge } from "./types";

export function useReplyCompletionBridge({
  baseIsWaitingForChatReply,
  chatTranscriptEntries,
  currentWaitingPrompt,
  hasCurrentWaitingPromptAssistantReply,
  isInterruptingPrompt
}: {
  baseIsWaitingForChatReply: boolean;
  chatTranscriptEntries: ChatTranscriptEntry[];
  currentWaitingPrompt: PendingChatPrompt | null;
  hasCurrentWaitingPromptAssistantReply: boolean;
  isInterruptingPrompt: boolean;
}) {
  const [replyCompletionBridge, setReplyCompletionBridge] =
    useState<ReplyCompletionBridge | null>(null);
  const observedWaitingPromptRef = useRef<PendingChatPrompt | null>(null);
  const replyCompletionBridgeTimerRef = useRef<number | null>(null);

  const currentWaitingPromptKey = currentWaitingPrompt
    ? buildPromptIdentity(currentWaitingPrompt)
    : "";

  const clearReplyCompletionBridge = useCallback(() => {
    if (replyCompletionBridgeTimerRef.current !== null) {
      window.clearTimeout(replyCompletionBridgeTimerRef.current);
      replyCompletionBridgeTimerRef.current = null;
    }

    setReplyCompletionBridge(null);
  }, []);

  const startReplyCompletionBridge = useCallback(
    (prompt: PendingChatPrompt) => {
      const key = buildPromptIdentity(prompt);

      if (replyCompletionBridgeTimerRef.current !== null) {
        window.clearTimeout(replyCompletionBridgeTimerRef.current);
      }

      setReplyCompletionBridge({ key, prompt });
      replyCompletionBridgeTimerRef.current = window.setTimeout(() => {
        replyCompletionBridgeTimerRef.current = null;
        setReplyCompletionBridge((current) => (current?.key === key ? null : current));
      }, FINAL_REPLY_SYNC_BRIDGE_MS);
    },
    []
  );

  const isReplyCompletionBridgeActive = useMemo(
    () =>
      replyCompletionBridge
        ? !hasAssistantReplyAfterPrompt(chatTranscriptEntries, replyCompletionBridge.prompt)
        : false,
    [chatTranscriptEntries, replyCompletionBridge]
  );

  useEffect(() => {
    if (isInterruptingPrompt) {
      observedWaitingPromptRef.current = null;
      clearReplyCompletionBridge();
      return;
    }

    if (
      baseIsWaitingForChatReply &&
      currentWaitingPrompt &&
      !hasCurrentWaitingPromptAssistantReply
    ) {
      observedWaitingPromptRef.current = currentWaitingPrompt;
      if (replyCompletionBridge?.key === currentWaitingPromptKey) {
        clearReplyCompletionBridge();
      }
      return;
    }

    const observedWaitingPrompt = observedWaitingPromptRef.current;
    if (!observedWaitingPrompt) {
      return;
    }

    if (hasAssistantReplyAfterPrompt(chatTranscriptEntries, observedWaitingPrompt)) {
      observedWaitingPromptRef.current = null;
      clearReplyCompletionBridge();
      return;
    }

    if (!baseIsWaitingForChatReply) {
      observedWaitingPromptRef.current = null;
      startReplyCompletionBridge(observedWaitingPrompt);
    }
  }, [
    baseIsWaitingForChatReply,
    chatTranscriptEntries,
    clearReplyCompletionBridge,
    currentWaitingPrompt,
    currentWaitingPromptKey,
    hasCurrentWaitingPromptAssistantReply,
    isInterruptingPrompt,
    replyCompletionBridge?.key,
    startReplyCompletionBridge
  ]);

  useEffect(() => {
    if (!replyCompletionBridge) {
      return;
    }

    if (
      isInterruptingPrompt ||
      hasAssistantReplyAfterPrompt(chatTranscriptEntries, replyCompletionBridge.prompt)
    ) {
      clearReplyCompletionBridge();
    }
  }, [
    chatTranscriptEntries,
    clearReplyCompletionBridge,
    isInterruptingPrompt,
    replyCompletionBridge
  ]);

  useEffect(
    () => () => {
      if (replyCompletionBridgeTimerRef.current !== null) {
        window.clearTimeout(replyCompletionBridgeTimerRef.current);
      }
    },
    []
  );

  return {
    isReplyCompletionBridgeActive,
    replyCompletionBridgePrompt: replyCompletionBridge?.prompt ?? null
  };
}
