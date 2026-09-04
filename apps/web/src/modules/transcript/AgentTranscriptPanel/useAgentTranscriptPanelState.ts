import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { filterHumanVisibleTranscriptEntries } from "@models/transcriptEntries";
import {
  canContinueAgentSession,
  getUnavailableChatPresentation
} from "@modules/agents/agentSessionAccessPresentation";

import { buildTranscriptTimeline } from "./AgentTranscriptPanel.timeline";
import {
  ATTACH_TRANSCRIPT_PREVIEW_ITEMS,
  buildAttachActionButtonLabel,
  buildTextOnlyTranscriptEntries,
  buildVisibleTranscriptPreviewEntries
} from "./helpers";
import type {
  AgentTranscriptPanelProps,
  AttachWaitStage,
  TextOnlyTranscriptEntry
} from "./types";

export function useAgentTranscriptPanelState({
  attachedManagedSessionId,
  attachedManagedSessionInfo,
  attaching,
  isLoading,
  loadError,
  previewItems = ATTACH_TRANSCRIPT_PREVIEW_ITEMS,
  selectedSessionId,
  session,
  sessionSummary
}: Pick<
  AgentTranscriptPanelProps,
  | "attachedManagedSessionId"
  | "attachedManagedSessionInfo"
  | "attaching"
  | "isLoading"
  | "loadError"
  | "previewItems"
  | "selectedSessionId"
  | "session"
  | "sessionSummary"
>) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [showModelContext, setShowModelContext] = useState(false);
  const [attachWaitStage, setAttachWaitStage] = useState<AttachWaitStage>("idle");

  const displayedSessionDetail = session?.id === selectedSessionId ? session : null;
  const displayedSessionSummary = sessionSummary?.id === selectedSessionId ? sessionSummary : null;
  const displaySession = displayedSessionDetail ?? displayedSessionSummary;
  const isWaitingForSessionDetail = Boolean(displayedSessionSummary) && !displayedSessionDetail;
  const isHydratingSelection = Boolean(displaySession) && (isLoading || isWaitingForSessionDetail);
  const hasBlockingLoadError = Boolean(loadError && !displayedSessionDetail);
  const isReviewOnlyRuntime =
    displaySession?.agentId === "other" && displaySession.agentLabel === "LM Studio";
  const canContinueSourceChat = displaySession ? canContinueAgentSession(displaySession) : false;
  const isSharedLiveThread = Boolean(displaySession) && !canContinueSourceChat;
  const isOpeningSharedLiveThread = attaching && isSharedLiveThread && !attachedManagedSessionId;
  const unavailableChatPresentation = displaySession
    ? getUnavailableChatPresentation(displaySession)
    : null;
  const sourceCapabilityLabel = hasBlockingLoadError
    ? "Chat unavailable"
    : isHydratingSelection
      ? "Loading chat"
      : canContinueSourceChat
        ? "Ready"
        : unavailableChatPresentation?.capabilityLabel ?? "View only";
  const actionButtonLabel = buildAttachActionButtonLabel({
    attachWaitStage,
    attaching,
    canResume: canContinueSourceChat,
    hasAttachedManagedSession: Boolean(attachedManagedSessionId),
    isOpeningSharedLiveThread,
    unavailableActionLabel: unavailableChatPresentation?.actionLabel ?? "Open view-only chat"
  });
  const hiddenPreviewText =
    canContinueSourceChat
      ? "Open this local thread in DeskCue and send a prompt when you are ready"
      : unavailableChatPresentation?.hint ?? "Open this local thread in DeskCue for review";
  const attachedViewerCount = attachedManagedSessionInfo?.viewerCount ?? 0;
  const attachedClientLabel =
    attachedViewerCount === 1
      ? "1 connected DeskCue client"
      : `${attachedViewerCount} connected DeskCue clients`;
  const attachedSessionHint = attachedManagedSessionInfo
    ? attachedManagedSessionInfo.status === "running"
      ? attachedViewerCount > 0
        ? attachedClientLabel
        : "Live chat connected"
      : attachedViewerCount > 0
        ? attachedClientLabel
        : "Live chat available"
    : null;

  const transcriptTimeline = useMemo(
    () => buildTranscriptTimeline(
      filterHumanVisibleTranscriptEntries(displayedSessionDetail?.transcript ?? [])
    ),
    [displayedSessionDetail?.transcript]
  );

  const textOnlyTranscriptEntries = useMemo(
    () => buildTextOnlyTranscriptEntries(transcriptTimeline),
    [transcriptTimeline]
  );

  const isTranscriptPreviewLoading =
    Boolean(displaySession) && isHydratingSelection && textOnlyTranscriptEntries.length === 0;
  const visibleTextOnlyTranscriptEntries = useMemo<TextOnlyTranscriptEntry[]>(
    () => buildVisibleTranscriptPreviewEntries(textOnlyTranscriptEntries, previewItems),
    [previewItems, textOnlyTranscriptEntries]
  );

  useEffect(() => {
    if (!displayedSessionDetail?.id || isLoading) return;

    const transcriptElement = transcriptRef.current;

    if (!transcriptElement) return;

    const animationFrame = window.requestAnimationFrame(() => {
      transcriptElement.scrollTop = transcriptElement.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [displayedSessionDetail?.id, displayedSessionDetail?.transcript.length, isLoading]);

  useEffect(() => {
    if (!attaching) {
      setAttachWaitStage("idle");
      return;
    }

    const startingTimer = window.setTimeout(() => {
      setAttachWaitStage("starting");
    }, 900);
    const slowTimer = window.setTimeout(() => {
      setAttachWaitStage("slow");
    }, 2_400);

    return () => {
      window.clearTimeout(startingTimer);
      window.clearTimeout(slowTimer);
    };
  }, [attaching]);

  return {
    actionButtonLabel,
    attachWaitStage,
    attachedSessionHint,
    displaySession,
    displayedSessionDetail,
    hiddenPreviewText,
    isActionPending: attaching,
    isHydratingSelection,
    isOpeningSharedLiveThread,
    isReviewOnlyRuntime,
    isSharedLiveThread,
    isTranscriptPreviewLoading,
    showModelContext,
    sourceCapabilityLabel,
    textOnlyTranscriptEntries,
    transcriptRef,
    unavailableChatPresentation,
    visibleTextOnlyTranscriptEntries,
    setShowModelContext
  };
}
