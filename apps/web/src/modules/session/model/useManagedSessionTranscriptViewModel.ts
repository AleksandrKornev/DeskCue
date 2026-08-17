import { useMemo } from "react";

import type { AgentSessionDetail } from "@deskcue/protocol";
import type { SessionTab } from "@models/sessionTabs";
import { filterHumanVisibleTranscriptEntries } from "@models/transcriptEntries";
import { buildConversationTimelineFromView } from "@modules/session/chat/timeline/ManagedSessionPanel.timeline";
import type { DiffPart } from "@modules/transcript";

import { emptyTranscriptEntries } from "./transcript/constants";
import {
  readManagedSessionActivityGroups,
  readTranscriptViewChatEntries
} from "./transcript/helpers";

export function useManagedSessionTranscriptViewModel({
  activeTab,
  isTakenOverAgentSessionLoading,
  takenOverAgentSession
}: {
  activeTab: SessionTab;
  isTakenOverAgentSessionLoading: boolean;
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

  const sourceDiffParts = useMemo(
    () =>
      activeTab === "diff"
        ? filterHumanVisibleTranscriptEntries(transcriptEntries).flatMap(
            (entry) => entry.parts?.filter((part): part is DiffPart => part.type === "diff") ?? []
          )
        : [],
    [activeTab, transcriptEntries]
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
    sourceDiffParts
  };
}
