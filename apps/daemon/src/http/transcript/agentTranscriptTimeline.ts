import type {
  AgentSessionDetail,
  AgentTranscriptEntry,
  AgentTranscriptTurnStatus,
  AgentTranscriptViewItem
} from "@deskcue/protocol";

import { orderConversationActivityRuns } from "./agentTranscriptActivityGroups.ts";
import {
  buildConversationContentTimeline,
  isChatMessageEntry
} from "./agentTranscriptContentTimeline.ts";
export {
  isChatMessageEntry,
  isContextCompactionEntry,
  isLifecycleStatusEntry,
  isModelChangeEntry
} from "./agentTranscriptContentTimeline.ts";

function getTurnStatusForEntry(
  entry: AgentTranscriptEntry,
  agentLabel: string,
  failedUserEntryStatuses: Map<string, AgentTranscriptTurnStatus>,
  incompleteUserEntryIds: Set<string>,
  interruptedUserEntryIds: Set<string>,
  supersededUserEntryIds: Set<string>
): AgentTranscriptTurnStatus | null {
  if (entry.role !== "user") {
    return null;
  }

  if (failedUserEntryStatuses.has(entry.id)) {
    return failedUserEntryStatuses.get(entry.id) ?? null;
  }

  if (incompleteUserEntryIds.has(entry.id)) {
    return {
      kind: "incomplete",
      label: "No final reply",
      title: `${agentLabel} finished this turn before DeskCue received a final assistant reply`
    };
  }

  if (interruptedUserEntryIds.has(entry.id)) {
    return {
      kind: "interrupted",
      label: "Interrupted",
      title: `This prompt was interrupted before ${agentLabel} returned an assistant reply`
    };
  }

  if (supersededUserEntryIds.has(entry.id)) {
    return {
      kind: "superseded",
      label: "Interrupted by next prompt",
      title: "A newer prompt started before DeskCue received a final assistant reply for this turn"
    };
  }

  return null;
}

function getStatusEntryDetail(entry: AgentTranscriptEntry) {
  if (entry.role !== "system") {
    return null;
  }

  const statusPart = entry.parts?.find((part) => part.type === "status");
  return statusPart?.type === "status" ? statusPart.detail : null;
}

function getTurnFailedStatus(
  entry: AgentTranscriptEntry,
  agentLabel: string
): AgentTranscriptTurnStatus {
  const detail = getStatusEntryDetail(entry) ?? entry.text;
  const normalizedDetail = detail.toLowerCase();

  return {
    kind: "failed",
    label: normalizedDetail.includes("selected model is at capacity")
      ? "Model at capacity"
      : "Turn failed",
    title: detail || `${agentLabel} reported a turn failure`
  };
}

function getStatusEntryLabel(entry: AgentTranscriptEntry) {
  if (entry.role !== "system") {
    return null;
  }

  const statusPart = entry.parts?.find((part) => part.type === "status");
  return statusPart?.type === "status" ? statusPart.label : entry.text;
}

function isTerminalTurnEntry(entry: AgentTranscriptEntry) {
  const label = getStatusEntryLabel(entry);
  return (
    label === "Turn completed" ||
    label === "Turn failed" ||
    label === "Turn interrupted"
  );
}

function isTurnCompletedEntry(entry: AgentTranscriptEntry) {
  return getStatusEntryLabel(entry) === "Turn completed";
}

function isTurnInterruptedEntry(entry: AgentTranscriptEntry) {
  return getStatusEntryLabel(entry) === "Turn interrupted";
}

function isTurnFailedEntry(entry: AgentTranscriptEntry) {
  return getStatusEntryLabel(entry) === "Turn failed";
}

function findLifecycleInterruptedUserEntryId(
  entries: AgentTranscriptEntry[],
  lifecycle: AgentSessionDetail["interruptLifecycle"]
) {
  if (!lifecycle || !lifecycle.turnFingerprint) {
    return null;
  }

  const wasVerifiedExternalProcessStopped =
    lifecycle.confirmation === "verified_process" && lifecycle.outcome === "interrupted";
  const wasManagedPromptTransportStopped = lifecycle.confirmation === "managed_transport";
  if (!wasVerifiedExternalProcessStopped && !wasManagedPromptTransportStopped) {
    return null;
  }

  const turnIndex = entries.findIndex((entry) => entry.id === lifecycle.turnFingerprint);
  if (turnIndex < 0) {
    return null;
  }

  if (entries[turnIndex]?.role === "user") {
    return lifecycle.turnFingerprint;
  }

  for (let index = turnIndex - 1; index >= 0; index -= 1) {
    if (entries[index]?.role === "user") {
      return entries[index]?.id ?? null;
    }
  }

  return null;
}

export function buildConversationTimeline(
  entries: AgentTranscriptEntry[],
  agentLabel: string,
  interruptLifecycle: AgentSessionDetail["interruptLifecycle"]
) {
  const failedUserEntryStatuses = new Map<string, AgentTranscriptTurnStatus>();
  const incompleteUserEntryIds = new Set<string>();
  const interruptedUserEntryIds = new Set<string>();
  const supersededUserEntryIds = new Set<string>();
  const lifecycleInterruptedUserEntryId = findLifecycleInterruptedUserEntryId(
    entries,
    interruptLifecycle
  );
  const primaryIndexes = entries
    .map((entry, index) => (isChatMessageEntry(entry) ? index : -1))
    .filter((index) => index >= 0);

  for (let position = 0; position < primaryIndexes.length; position += 1) {
    const currentIndex = primaryIndexes[position];
    const currentEntry = entries[currentIndex];
    if (currentEntry.role !== "user") {
      continue;
    }

    const nextUserPosition = primaryIndexes.findIndex(
      (index, candidatePosition) =>
        candidatePosition > position && entries[index]?.role === "user"
    );
    const nextUserIndex =
      nextUserPosition >= 0 ? primaryIndexes[nextUserPosition] : entries.length;
    const entriesBeforeNextUserTurn = entries.slice(currentIndex + 1, nextUserIndex);
    const hasAssistantReply = entriesBeforeNextUserTurn.some(
      (entry) => entry.role === "assistant"
    );
    const failedTurnEntry = !hasAssistantReply
      ? entriesBeforeNextUserTurn.find(isTurnFailedEntry)
      : undefined;
    const hasInterruptedTurn = entriesBeforeNextUserTurn.some(isTurnInterruptedEntry);
    const hasCompletedTurn =
      !hasAssistantReply && entriesBeforeNextUserTurn.some(isTurnCompletedEntry);
    const hasTerminalTurn =
      !hasAssistantReply && entriesBeforeNextUserTurn.some(isTerminalTurnEntry);

    if (failedTurnEntry) {
      failedUserEntryStatuses.set(
        currentEntry.id,
        getTurnFailedStatus(failedTurnEntry, agentLabel)
      );
      continue;
    }

    if (hasInterruptedTurn || currentEntry.id === lifecycleInterruptedUserEntryId) {
      interruptedUserEntryIds.add(currentEntry.id);
      continue;
    }

    if (hasCompletedTurn) {
      incompleteUserEntryIds.add(currentEntry.id);
      continue;
    }

    if (nextUserPosition < 0 || hasTerminalTurn) {
      continue;
    }

    if (!hasAssistantReply) {
      supersededUserEntryIds.add(currentEntry.id);
    }
  }

  const items: AgentTranscriptViewItem[] = [];

  for (const item of buildConversationContentTimeline(entries)) {
    if (item.type === "entry") {
      const changeActivities = item.activities.filter(
        (activity) => activity.kind === "changes"
      );
      const otherActivities = item.activities.filter(
        (activity) => activity.kind !== "changes"
      );

      items.push({
        type: "message",
        key: item.id,
        role: item.entry.role as "user" | "assistant",
        timestamp: item.entry.timestamp,
        entry: item.entry,
        activities: otherActivities,
        changeActivities,
        turnStatus: getTurnStatusForEntry(
          item.entry,
          agentLabel,
          failedUserEntryStatuses,
          incompleteUserEntryIds,
          interruptedUserEntryIds,
          supersededUserEntryIds
        )
      });
      continue;
    }

    items.push({
      type: "activity",
      key: item.id,
      activity: item.activity
    });
  }

  return orderConversationActivityRuns(items);
}
