import { useMemo } from "react";

import type { AgentSessionDetail } from "@deskcue/protocol";
import type { SessionTab } from "@models/sessionTabs";
import { buildConversationTimelineFromView } from "@modules/session/chat/timeline/ManagedSessionPanel.timeline";

import { emptyTranscriptEntries } from "./transcript/constants";
import {
  readAgentReportedDiffProjection,
  readManagedSessionActivityGroups,
  readTranscriptViewChatEntries
} from "./transcript/helpers";

export function useManagedSessionTranscriptViewModel({
  activeTab,
  isTakenOverAgentSessionLoading,
  sourceTranscriptHistoryIncomplete,
  takenOverAgentSession
}: {
  activeTab: SessionTab;
  isTakenOverAgentSessionLoading: boolean;
  sourceTranscriptHistoryIncomplete: boolean;
  takenOverAgentSession: AgentSessionDetail | null;
}) {
  const shouldDeferCachedTranscript = isTakenOverAgentSessionLoading;
  const transcriptView = shouldDeferCachedTranscript
    ? null
    : takenOverAgentSession?.transcriptView ?? null;
  const transcriptEntries = useMemo(
    () =>
      shouldDeferCachedTranscript
        ? emptyTranscriptEntries
        : takenOverAgentSession?.transcript ?? emptyTranscriptEntries,
    [shouldDeferCachedTranscript, takenOverAgentSession?.transcript]
  );

  const chatTranscriptEntries = useMemo(
    () => readTranscriptViewChatEntries(transcriptView),
    [transcriptView]
  );

  const activityGroups = useMemo(
    () =>
      activeTab === "activity"
        ? readManagedSessionActivityGroups(transcriptView, transcriptEntries)
        : [],
    [activeTab, transcriptEntries, transcriptView]
  );

  const sourceDiffProjection = useMemo(
    () =>
      activeTab === "diff"
        ? readAgentReportedDiffProjection(
            transcriptEntries,
            sourceTranscriptHistoryIncomplete
          )
        : { detailsUnavailable: false, parts: [] },
    [activeTab, sourceTranscriptHistoryIncomplete, transcriptEntries]
  );

  const isTranscriptLoading = isTakenOverAgentSessionLoading;

  const conversationTimeline = useMemo(
    () =>
      transcriptView
        ? buildConversationTimelineFromView(transcriptView)
        : [],
    [transcriptView]
  );

  const hasConversationContent = conversationTimeline.some((item) => item.type !== "day");

  return {
    activityGroups,
    chatTranscriptEntries,
    conversationTimeline,
    hasConversationContent,
    isTranscriptLoading,
    latestWaitingDetailEntry: transcriptView?.latestWaitingDetailEntry ?? null,
    sourceDiffDetailsUnavailable: sourceDiffProjection.detailsUnavailable,
    sourceDiffParts: sourceDiffProjection.parts
  };
}
