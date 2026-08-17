import { useEffect, useRef } from "react";

import {
  hasPromptCompletionInTranscript
} from "@models/promptDelivery";
import type { PendingChatPrompt } from "@models/promptDelivery";
import { agentChatDetailResource } from "@modules/dashboard/model/chatDetail/resource/agentChatDetailResource";
import {
  isPromptForActiveSelection,
  PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS
} from "@modules/dashboard/model/liveUpdates/helpers";

import {
  PROMPT_TRANSCRIPT_SYNC_RETRY_MS,
  PROMPT_TRANSCRIPT_SYNC_WINDOW_MS
} from "./constants";
import { buildSourceAgentSessionId } from "./helpers";
import type { UseDashboardPromptReplyWatchdogArgs } from "./types";

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
  const promptAwaitingTranscriptRef = useRef<PendingChatPrompt | null>(null);
  const promptTranscriptSyncDeadlineRef = useRef(0);
  const selectedSessionReplyState = selectedSession?.replyState;
  const selectedSessionReplyPhase = selectedSessionReplyState?.phase;
  const selectedSessionReplyRequestedAt = selectedSessionReplyState?.requestedAt;
  const selectedSourceAgentSessionId = buildSourceAgentSessionId(selectedSession);
  const pendingPromptKey = pendingChatPrompt
    ? `${pendingChatPrompt.requestedAt}\u0000${pendingChatPrompt.text}`
    : "";

  useEffect(() => {
    const shouldWatchPendingPrompt =
      isPromptForActiveSelection(
        pendingChatPrompt,
        selectedSessionId,
        selectedSession?.sourceSessionId ?? null
      );
    if (shouldWatchPendingPrompt && pendingChatPrompt) {
      promptAwaitingTranscriptRef.current = pendingChatPrompt;
      promptTranscriptSyncDeadlineRef.current = Date.now() + PROMPT_TRANSCRIPT_SYNC_WINDOW_MS;
    }

    const promptAwaitingTranscript = promptAwaitingTranscriptRef.current;
    const shouldSyncRecordedPrompt = Boolean(
      promptAwaitingTranscript &&
      Date.now() < promptTranscriptSyncDeadlineRef.current &&
      isPromptForActiveSelection(
        promptAwaitingTranscript,
        selectedSessionId,
        selectedSession?.sourceSessionId ?? null
      )
    );
    const hasTakenOverTranscript =
      Boolean(selectedSession?.sourceSessionId) ||
      Boolean(activeTakenOverAgentSessionSummaryId) ||
      Boolean(activeTakenOverAgentSessionIdRef.current);
    const shouldPollForPromptReply =
      activeTab === "overview" &&
      Boolean(selectedSessionId) &&
      hasTakenOverTranscript &&
      (
        shouldWatchPendingPrompt ||
        shouldSyncRecordedPrompt ||
        selectedSessionReplyPhase === "sending" ||
        selectedSessionReplyPhase === "waiting"
      );

    promptReplyPollingActiveRef.current = shouldPollForPromptReply;

    if (!shouldPollForPromptReply) {
      return;
    }

    let cancelled = false;
    let pollTimer: number | null = null;

    const clearPollTimer = () => {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const pollPromptReplyState = async () => {
      clearPollTimer();

      const agentSessionId =
        activeTakenOverAgentSessionIdRef.current ||
        selectedAgentSessionIdRef.current ||
        selectedSourceAgentSessionId;
      const managedSessionId = selectedSessionIdRef.current;
      if (!agentSessionId || !managedSessionId || activeTabRef.current !== "overview") {
        return;
      }

      try {
        const agentSession = await agentChatDetailResource.refreshNow(agentSessionId, {
          activeTab: "overview",
          force: true,
          reason: "prompt-watchdog",
          retry: true,
          transcriptDetail: "summary"
        });

        if (!cancelled && agentSession && agentSessionId === agentSession.id) {
          applyFetchedAgentSessionDetail(agentSession);
        }

        const hasPromptReply =
          promptAwaitingTranscript &&
          agentSession &&
          hasPromptCompletionInTranscript(agentSession, promptAwaitingTranscript);

        if (hasPromptReply) {
          promptAwaitingTranscriptRef.current = null;
          promptTranscriptSyncDeadlineRef.current = 0;
          await loadSessionRef.current(managedSessionId, {
            silent: true,
            sessionView: "chat"
          });
        } else if (!cancelled && Date.now() < promptTranscriptSyncDeadlineRef.current) {
          pollTimer = window.setTimeout(() => {
            void pollPromptReplyState();
          }, PROMPT_TRANSCRIPT_SYNC_RETRY_MS);
        } else {
          promptReplyPollingActiveRef.current = false;
        }
      } catch {
        if (!cancelled && Date.now() < promptTranscriptSyncDeadlineRef.current) {
          pollTimer = window.setTimeout(() => {
            void pollPromptReplyState();
          }, PROMPT_TRANSCRIPT_SYNC_RETRY_MS);
        }
      }
    };

    pollTimer = window.setTimeout(
      () => {
        void pollPromptReplyState();
      },
      PROMPT_REPLY_SYNC_WATCHDOG_DELAY_MS
    );

    return () => {
      cancelled = true;
      promptReplyPollingActiveRef.current = false;
      clearPollTimer();
    };
  }, [
    activeTab,
    activeTabRef,
    activeTakenOverAgentSessionIdRef,
    activeTakenOverAgentSessionSummaryId,
    applyFetchedAgentSessionDetail,
    loadSessionRef,
    selectedSessionReplyPhase,
    selectedSessionReplyRequestedAt,
    selectedSession?.sourceSessionId,
    selectedSourceAgentSessionId,
    selectedSessionId,
    selectedSessionIdRef,
    selectedAgentSessionIdRef,
    pendingChatPrompt,
    pendingPromptKey,
    promptReplyPollingActiveRef
  ]);
}
