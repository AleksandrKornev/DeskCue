import { useEffect, useRef } from "react";

import type { PendingChatPrompt } from "@models/promptDelivery";
import { PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS } from "@modules/dashboard/model/liveUpdates/helpers";

import { buildSourceAgentSessionId, isPendingPromptForSelection } from "./helpers";
import type { UseDashboardPromptReplyWatchdogArgs } from "./types";
import { PromptReplyWatchdogController } from "./watchdog/promptReplyWatchdogController";
import {
  buildPromptKey,
  canPoll,
  createPromptWatch,
  isManagedReplyActive,
  updatePromptWatchActivity
} from "./watchdog/promptReplyWatchdogState";
import type { PromptWatch } from "./watchdog/promptReplyWatchdogState";

export function useDashboardPromptReplyWatchdog({
  activeTab,
  activeTabRef,
  activeTakenOverAgentSessionIdRef,
  activeTakenOverAgentSessionSummaryId,
  applyFetchedAgentSessionDetail,
  loadSessionRef,
  pendingChatPrompt,
  promptReplyPollingActiveRef,
  selectedSession,
  selectedSessionId,
  selectedSessionIdRef,
  selectedAgentSessionIdRef
}: UseDashboardPromptReplyWatchdogArgs) {
  const applyFetchedAgentSessionDetailRef = useRef(applyFetchedAgentSessionDetail);
  const promptWatchRef = useRef<PromptWatch | null>(null);
  const watchdogGenerationRef = useRef(0);

  applyFetchedAgentSessionDetailRef.current = applyFetchedAgentSessionDetail;

  const selectedReplyPhase = selectedSession?.replyState.phase;
  const selectedReplyPromptText = selectedSession?.replyState.promptText;
  const selectedReplyRequestedAt = selectedSession?.replyState.requestedAt;
  const selectedSourceSessionId = selectedSession?.sourceSessionId ?? null;
  const selectedSourceAgentSessionId = buildSourceAgentSessionId(selectedSession);
  const agentSessionId = selectedSourceAgentSessionId ||
    activeTakenOverAgentSessionSummaryId ||
    activeTakenOverAgentSessionIdRef.current ||
    selectedAgentSessionIdRef.current;
  const restoreManagedPrompt = !pendingChatPrompt &&
    isManagedReplyActive(selectedReplyPhase) &&
    Boolean(selectedReplyPromptText && selectedReplyRequestedAt);
  const promptText = pendingChatPrompt?.text ??
    (restoreManagedPrompt ? selectedReplyPromptText : null);
  const promptRequestedAt = pendingChatPrompt?.requestedAt ??
    (restoreManagedPrompt ? selectedReplyRequestedAt : null);
  const promptManagedSessionId = pendingChatPrompt?.sessionId ?? selectedSessionId;
  const promptSourceSessionId = pendingChatPrompt?.sourceSessionId ??
    selectedSourceSessionId ??
    undefined;
  const managedPromptActive = selectedSession?.status === "running" ||
    isManagedReplyActive(selectedReplyPhase);

  useEffect(() => {
    const now = Date.now();
    const generation = ++watchdogGenerationRef.current;
    const prompt = promptText && promptRequestedAt
      ? {
          requestedAt: promptRequestedAt,
          sessionId: promptManagedSessionId,
          sourceSessionId: promptSourceSessionId,
          text: promptText
        } satisfies PendingChatPrompt
      : null;
    const promptMatchesSelection = isPendingPromptForSelection(
      prompt,
      selectedSessionId,
      selectedSourceSessionId
    );

    if (prompt && promptMatchesSelection && agentSessionId) {
      const candidate = {
        agentSessionId,
        managedPromptActive,
        managedSessionId: selectedSessionId,
        prompt,
        sourceSessionId: selectedSourceSessionId
      };

      const promptKey = buildPromptKey(prompt, agentSessionId, selectedSourceSessionId);

      if (promptWatchRef.current?.key !== promptKey) promptWatchRef.current = createPromptWatch(candidate, now);
    }

    const watch = promptWatchRef.current;
    const watchMatchesSelection = Boolean(
      watch &&
      watch.managedSessionId === selectedSessionId &&
      watch.sourceSessionId === selectedSourceSessionId &&
      watch.agentSessionId === agentSessionId
    );

    if (!watchMatchesSelection) {
      promptWatchRef.current = null;
    } else if (watch) {
      updatePromptWatchActivity(watch, managedPromptActive, now);
    }

    const activeWatch = promptWatchRef.current;
    const shouldPoll = Boolean(
      activeTab === "overview" &&
      activeWatch &&
      canPoll(activeWatch, now)
    );

    promptReplyPollingActiveRef.current = shouldPoll;
    if (!shouldPoll || !activeWatch) return;

    const controller = new PromptReplyWatchdogController({
      applyAgentSession: (session) => {
        applyFetchedAgentSessionDetailRef.current(session);
      },
      completePrompt: () => {
        void loadSessionRef.current(activeWatch.managedSessionId, {
          silent: true,
          sessionView: "chat"
        });
      },
      isCurrentWatch: () => {
        const currentWatch = promptWatchRef.current;

        return watchdogGenerationRef.current === generation &&
          activeTabRef.current === "overview" &&
          selectedSessionIdRef.current === activeWatch.managedSessionId &&
          currentWatch?.key === activeWatch.key &&
          currentWatch.agentSessionId === activeWatch.agentSessionId;
      },
      setPollingActive: (active) => {
        promptReplyPollingActiveRef.current = active;
      },
      watch: activeWatch
    });

    controller.start(PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS);
    return () => {
      controller.dispose();
    };
  }, [
    activeTab,
    activeTabRef,
    activeTakenOverAgentSessionIdRef,
    agentSessionId,
    loadSessionRef,
    managedPromptActive,
    promptManagedSessionId,
    promptReplyPollingActiveRef,
    promptRequestedAt,
    promptSourceSessionId,
    promptText,
    selectedSessionId,
    selectedSessionIdRef,
    selectedSourceSessionId
  ]);
}
