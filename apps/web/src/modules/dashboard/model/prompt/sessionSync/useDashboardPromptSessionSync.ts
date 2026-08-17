import { useEffect } from "react";
import type {
  Dispatch,
  SetStateAction
} from "react";

import type {
  AgentSessionDetail,
  SessionDetail
} from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";

import {
  getCancelledPromptCleanupDelay,
  resolvePromptSessionSyncAction,
  shouldResetPromptStateForSelection
} from "./helpers";

export function useDashboardPromptSessionSync({
  activeTakenOverAgentSession,
  awaitingChatReplySince,
  clearPromptStateForCompletedPrompt,
  isInterruptingPrompt,
  isWaitingForChatReply,
  pendingChatPrompt,
  selectedSession,
  selectedSessionId,
  setAwaitingChatReplySince,
  setIsInterruptingPrompt,
  setIsWaitingForChatReply,
  setPendingChatPrompt
}: {
  activeTakenOverAgentSession: AgentSessionDetail | null;
  awaitingChatReplySince: string | null;
  clearPromptStateForCompletedPrompt: (prompt: PendingChatPrompt) => void;
  isInterruptingPrompt: boolean;
  isWaitingForChatReply: boolean;
  pendingChatPrompt: PendingChatPrompt | null;
  selectedSession: SessionDetail | null;
  selectedSessionId: string;
  setAwaitingChatReplySince: (value: string | null) => void;
  setIsInterruptingPrompt: (value: boolean) => void;
  setIsWaitingForChatReply: (value: boolean) => void;
  setPendingChatPrompt: Dispatch<SetStateAction<PendingChatPrompt | null>>;
}) {
  useEffect(() => {
    if (!shouldResetPromptStateForSelection({
      awaitingChatReplySince,
      isWaitingForChatReply,
      pendingChatPrompt,
      selectedSession,
      selectedSessionId
    })) {
      return;
    }

    setPendingChatPrompt(null);
    setAwaitingChatReplySince(null);
    setIsWaitingForChatReply(false);
    setIsInterruptingPrompt(false);
  }, [
    awaitingChatReplySince,
    isInterruptingPrompt,
    isWaitingForChatReply,
    pendingChatPrompt,
    selectedSession,
    selectedSessionId,
    setAwaitingChatReplySince,
    setIsInterruptingPrompt,
    setIsWaitingForChatReply,
    setPendingChatPrompt
  ]);

  useEffect(() => {
    const action = resolvePromptSessionSyncAction({
      activeTakenOverAgentSession,
      awaitingChatReplySince,
      isInterruptingPrompt,
      isWaitingForChatReply,
      pendingChatPrompt,
      selectedSession
    });

    if (action.kind === "none") {
      return;
    }

    if (action.kind === "clear-completed") {
      clearPromptStateForCompletedPrompt(action.prompt);
      return;
    }

    if (action.kind === "set-pending") {
      setPendingChatPrompt(action.prompt);
      setAwaitingChatReplySince(null);
      setIsWaitingForChatReply(false);
      return;
    }

    if (action.kind === "mark-waiting") {
      setPendingChatPrompt({
        ...action.prompt,
        status: "waiting"
      });
      setAwaitingChatReplySince(action.prompt.requestedAt);
      setIsWaitingForChatReply(true);
      return;
    }

    if (action.kind === "clear-waiting") {
      setAwaitingChatReplySince(null);
      setIsWaitingForChatReply(false);
      return;
    }

    setPendingChatPrompt(null);
    setAwaitingChatReplySince(null);
    setIsWaitingForChatReply(false);
  }, [
    activeTakenOverAgentSession,
    awaitingChatReplySince,
    clearPromptStateForCompletedPrompt,
    isInterruptingPrompt,
    isWaitingForChatReply,
    pendingChatPrompt,
    selectedSession,
    setAwaitingChatReplySince,
    setIsWaitingForChatReply,
    setPendingChatPrompt
  ]);

  useEffect(() => {
    if (pendingChatPrompt?.status !== "cancelled") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPendingChatPrompt((currentPrompt) => (
        currentPrompt?.status === "cancelled" &&
        currentPrompt.requestedAt === pendingChatPrompt.requestedAt &&
        currentPrompt.text === pendingChatPrompt.text
          ? null
          : currentPrompt
      ));
      setAwaitingChatReplySince(null);
      setIsWaitingForChatReply(false);
    }, getCancelledPromptCleanupDelay(pendingChatPrompt));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    pendingChatPrompt,
    setAwaitingChatReplySince,
    setIsWaitingForChatReply,
    setPendingChatPrompt
  ]);
}
