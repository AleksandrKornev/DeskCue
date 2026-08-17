import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { AgentSessionDetail, SessionDetail } from "@deskcue/protocol";
import {
  hasPromptConfirmationInTranscript
} from "@models/promptDelivery";
import type { PendingChatPrompt } from "@models/promptDelivery";
import { getSessionInterruptLifecycle } from "@models/sessionInterruptLifecycle";
import { useDashboardPromptSessionSync } from "@modules/dashboard/model/prompt/sessionSync";

import {
  buildReplyStateDrivenPendingChatPrompt,
  buildPromptStateKey,
  resolveEffectivePromptState,
  shouldClearLocalInterruptForSourceState
} from "./helpers";
import type { LocalInterruptMarker } from "./helpers";
import type { PromptStateCache } from "./types";

export function useDashboardPromptState(
  selectedSessionId: string,
  selectedSession: SessionDetail | null,
  activeTakenOverAgentSession: AgentSessionDetail | null,
  cachedState: PromptStateCache
) {
  const [pendingChatPrompt, setPendingChatPrompt] = useState<PendingChatPrompt | null>(
    () => cachedState.pendingChatPrompt ?? null
  );

  const [awaitingChatReplySince, setAwaitingChatReplySince] = useState<string | null>(
    () => cachedState.awaitingChatReplySince ?? null
  );

  const [isWaitingForChatReply, setIsWaitingForChatReply] = useState(
    () => cachedState.isWaitingForChatReply ?? false
  );

  const [isInterruptingPrompt, setIsInterruptingPrompt] = useState(false);
  const [immediateInterruptPrompt, setImmediateInterruptPrompt] = useState<PendingChatPrompt | null>(null);
  const interruptMarkerRef = useRef<LocalInterruptMarker | null>(null);
  const handledCompletedPromptKeyRef = useRef("");

  const setTrackedInterruptingPrompt = useCallback((value: boolean) => {
    if (value && !interruptMarkerRef.current) {
      const interruptLifecycle = getSessionInterruptLifecycle(activeTakenOverAgentSession);
      interruptMarkerRef.current = {
        managedSessionId: selectedSessionId,
        sourceSessionId:
          activeTakenOverAgentSession?.sourceSessionId ?? selectedSession?.sourceSessionId ?? null,
        priorInterruptRequestedAt: interruptLifecycle.requestedAt,
        priorInterruptTurnFingerprint: interruptLifecycle.turnFingerprint,
        priorTurnCompletedAt: activeTakenOverAgentSession?.turnState?.completedAt ?? null,
        priorTurnFingerprint: activeTakenOverAgentSession?.turnState?.fingerprint ?? null
      };
    }
    if (value) {
      const replyStatePrompt = buildReplyStateDrivenPendingChatPrompt(
        selectedSession,
        activeTakenOverAgentSession
      );
      const prompt = pendingChatPrompt ?? replyStatePrompt;
      if (prompt?.text.trim() && prompt.requestedAt) {
        setImmediateInterruptPrompt({
          ...prompt,
          sessionId: prompt.sessionId ?? selectedSessionId,
          sourceSessionId: prompt.sourceSessionId ?? selectedSession?.sourceSessionId ?? undefined
        });
      }
    }
    if (!value) {
      interruptMarkerRef.current = null;
    }
    setIsInterruptingPrompt(value);
  }, [
    activeTakenOverAgentSession,
    pendingChatPrompt,
    selectedSession,
    selectedSessionId
  ]);

  useEffect(() => {
    if (!isInterruptingPrompt) {
      return;
    }

    if (shouldClearLocalInterruptForSourceState(
      interruptMarkerRef.current,
      activeTakenOverAgentSession
    )) {
      setTrackedInterruptingPrompt(false);
    }
  }, [activeTakenOverAgentSession, isInterruptingPrompt, setTrackedInterruptingPrompt]);

  useEffect(() => {
    const selectedSourceSessionId =
      activeTakenOverAgentSession?.sourceSessionId ?? selectedSession?.sourceSessionId ?? null;
    if (
      isInterruptingPrompt &&
      (
        interruptMarkerRef.current?.managedSessionId !== selectedSessionId ||
        interruptMarkerRef.current?.sourceSessionId !== selectedSourceSessionId
      )
    ) {
      setTrackedInterruptingPrompt(false);
    }
  }, [
    activeTakenOverAgentSession?.sourceSessionId,
    isInterruptingPrompt,
    selectedSession?.sourceSessionId,
    selectedSessionId,
    setTrackedInterruptingPrompt
  ]);

  useEffect(() => {
    if (!immediateInterruptPrompt) {
      return;
    }

    if (
      immediateInterruptPrompt.sessionId &&
      immediateInterruptPrompt.sessionId !== selectedSessionId
    ) {
      setImmediateInterruptPrompt(null);
      return;
    }

    if (hasPromptConfirmationInTranscript(activeTakenOverAgentSession, immediateInterruptPrompt)) {
      setImmediateInterruptPrompt(null);
    }
  }, [activeTakenOverAgentSession, immediateInterruptPrompt, selectedSessionId]);

  const clearPromptStateForCompletedPrompt = useCallback((prompt: PendingChatPrompt) => {
    const completedPromptKey = buildPromptStateKey(prompt.text, prompt.requestedAt);
    if (handledCompletedPromptKeyRef.current === completedPromptKey) {
      return;
    }

    handledCompletedPromptKeyRef.current = completedPromptKey;
    if (pendingChatPrompt || awaitingChatReplySince || isWaitingForChatReply) {
      setPendingChatPrompt(null);
      setAwaitingChatReplySince(null);
      setIsWaitingForChatReply(false);
    }
  }, [awaitingChatReplySince, isWaitingForChatReply, pendingChatPrompt]);

  useDashboardPromptSessionSync({
    activeTakenOverAgentSession,
    awaitingChatReplySince,
    clearPromptStateForCompletedPrompt,
    isInterruptingPrompt,
    isWaitingForChatReply,
    pendingChatPrompt,
    selectedSession,
    selectedSessionId,
    setAwaitingChatReplySince,
    setIsInterruptingPrompt: setTrackedInterruptingPrompt,
    setIsWaitingForChatReply,
    setPendingChatPrompt
  });

  const replyStateDrivenPendingChatPrompt = useMemo(() => {
    return buildReplyStateDrivenPendingChatPrompt(
      selectedSession,
      activeTakenOverAgentSession
    );
  }, [activeTakenOverAgentSession, selectedSession]);

  const {
    effectiveIsWaitingForChatReply,
    effectivePendingChatPrompt
  } = resolveEffectivePromptState({
    awaitingChatReplySince,
    isWaitingForChatReply,
    pendingChatPrompt,
    replyStateDrivenPendingChatPrompt,
    selectedSession
  });

  return {
    pendingChatPrompt,
    awaitingChatReplySince,
    isWaitingForChatReply,
    isInterruptingPrompt,
    immediateInterruptPrompt,
    effectivePendingChatPrompt,
    effectiveIsWaitingForChatReply,
    setPendingChatPrompt,
    setAwaitingChatReplySince,
    setIsWaitingForChatReply,
    setIsInterruptingPrompt: setTrackedInterruptingPrompt,
  };
}
