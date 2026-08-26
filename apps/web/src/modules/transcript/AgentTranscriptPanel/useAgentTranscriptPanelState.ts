import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { filterHumanVisibleTranscriptEntries } from "@models/transcriptEntries";
import { getUnavailableChatPresentation } from "@modules/agents/agentSessionAccessPresentation";

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
  previewItems = ATTACH_TRANSCRIPT_PREVIEW_ITEMS,
  session,
  sessionSummary
}: Pick<
  AgentTranscriptPanelProps,
  | "attachedManagedSessionId"
  | "attachedManagedSessionInfo"
  | "attaching"
  | "isLoading"
  | "previewItems"
  | "session"
  | "sessionSummary"
>) {
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [showModelContext, setShowModelContext] = useState(false);
  const [attachWaitStage, setAttachWaitStage] = useState<AttachWaitStage>("idle");

  const displaySession = session ?? sessionSummary ?? null;
  const isWaitingForSessionDetail = Boolean(sessionSummary) && !session;
  const isHydratingSelection = Boolean(displaySession) && (isLoading || isWaitingForSessionDetail);
  const isReviewOnlyRuntime =
    displaySession?.agentId === "other" && displaySession.agentLabel === "LM Studio";
  const isSharedLiveThread = displaySession?.attachMode !== "resume";
  const isOpeningSharedLiveThread = attaching && isSharedLiveThread && !attachedManagedSessionId;
  const unavailableChatPresentation = displaySession
    ? getUnavailableChatPresentation(displaySession)
    : null;
  const sourceCapabilityLabel = isHydratingSelection
    ? "Loading chat"
    : displaySession?.attachMode === "resume"
      ? "Ready to continue"
      : unavailableChatPresentation?.capabilityLabel ?? "View only";
  const actionButtonLabel = buildAttachActionButtonLabel({
    attachWaitStage,
    attaching,
    canResume: displaySession?.attachMode === "resume",
    hasAttachedManagedSession: Boolean(attachedManagedSessionId),
    isOpeningSharedLiveThread,
    unavailableActionLabel: unavailableChatPresentation?.actionLabel ?? "Open view-only chat"
  });
  const hiddenPreviewText =
    displaySession?.attachMode === "resume"
      ? "Open this local thread in DeskCue and send a prompt when you are ready"
      : unavailableChatPresentation?.hint ?? "Open this local thread in DeskCue for review";
  const attachedViewerCount = attachedManagedSessionInfo?.viewerCount ?? 0;
  const attachedClientLabel =
    attachedViewerCount === 1
      ? "1 DeskCue client"
      : `${attachedViewerCount} DeskCue clients`;
  const attachedSessionHint = attachedManagedSessionInfo
    ? attachedManagedSessionInfo.status === "running"
      ? attachedViewerCount > 0
        ? `DeskCue is attached in ${attachedClientLabel}`
        : "DeskCue is attached to this local chat"
      : attachedViewerCount > 0
        ? `DeskCue chat is open in ${attachedClientLabel}`
        : "A DeskCue chat is available"
    : null;

  const transcriptTimeline = useMemo(
    () => buildTranscriptTimeline(filterHumanVisibleTranscriptEntries(session?.transcript ?? [])),
    [session?.transcript]
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
    if (!session?.id || isLoading) return;

    const transcriptElement = transcriptRef.current;

    if (!transcriptElement) return;

    const animationFrame = window.requestAnimationFrame(() => {
      transcriptElement.scrollTop = transcriptElement.scrollHeight;
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isLoading, session?.id, session?.transcript.length]);

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
