import type {
  AgentSessionObservedTurnState,
  AgentSessionSummary,
  AgentTranscriptActivityGroup,
  AgentTranscriptEntry,
  AgentTranscriptSourceRange,
  AgentTranscriptTurnStatus
} from "@deskcue/protocol";
import { getSessionInterruptLifecycle } from "@models/sessionInterruptLifecycle";

export function areInterruptLifecyclesEqual(left: object, right: object) {
  const leftLifecycle = getSessionInterruptLifecycle(left);
  const rightLifecycle = getSessionInterruptLifecycle(right);

  return leftLifecycle.phase === rightLifecycle.phase &&
    leftLifecycle.requestedAt === rightLifecycle.requestedAt &&
    leftLifecycle.confirmedAt === rightLifecycle.confirmedAt &&
    leftLifecycle.turnFingerprint === rightLifecycle.turnFingerprint &&
    leftLifecycle.confirmation === rightLifecycle.confirmation;
}

export function areObservedTurnStatesEqual(
  left: AgentSessionObservedTurnState | undefined,
  right: AgentSessionObservedTurnState | undefined
) {
  if (left === right) return true;
  if (!left || !right) return false;

  return left.activityAt === right.activityAt &&
    left.completedAt === right.completedAt &&
    left.evidence === right.evidence &&
    left.fingerprint === right.fingerprint &&
    left.phase === right.phase &&
    left.startedAt === right.startedAt;
}

function areSourceEntryRangesEqual(
  left: AgentTranscriptSourceRange[] | undefined,
  right: AgentTranscriptSourceRange[] | undefined
) {
  const leftValues = left ?? [];
  const rightValues = right ?? [];

  if (leftValues.length !== rightValues.length) return false;

  return leftValues.every((value, index) => {
    const rightValue = rightValues[index];

    return rightValue !== undefined &&
      value.prefix === rightValue.prefix &&
      value.start === rightValue.start &&
      value.end === rightValue.end;
  });
}

function areStringArraysEqual(left: string[] | undefined, right: string[] | undefined) {
  const leftValues = left ?? [];
  const rightValues = right ?? [];

  return leftValues.length === rightValues.length &&
    leftValues.every((value, index) => value === rightValues[index]);
}

function areTranscriptPartEqual(
  left: NonNullable<AgentTranscriptEntry["parts"]>[number],
  right: NonNullable<AgentTranscriptEntry["parts"]>[number] | undefined
) {
  if (!right || left.type !== right.type) return false;

  switch (left.type) {
    case "attachment":
      return right.type === "attachment" &&
        left.kind === right.kind &&
        left.label === right.label &&
        left.path === right.path &&
        left.url === right.url;
    case "diff":
      return right.type === "diff" &&
        left.title === right.title &&
        left.text === right.text &&
        left.filePath === right.filePath &&
        left.changeType === right.changeType &&
        left.additions === right.additions &&
        left.deletions === right.deletions;
    case "markdown":
      return right.type === "markdown" && left.text === right.text;
    case "status":
      return right.type === "status" &&
        left.label === right.label &&
        left.detail === right.detail;
    case "tool_call":
      return right.type === "tool_call" &&
        left.toolName === right.toolName &&
        left.namespace === right.namespace &&
        left.argumentsText === right.argumentsText;
    case "tool_result":
      return right.type === "tool_result" &&
        left.toolName === right.toolName &&
        left.status === right.status &&
        left.text === right.text;
  }
}

function areTranscriptPartsEqual(
  left: AgentTranscriptEntry["parts"],
  right: AgentTranscriptEntry["parts"]
) {
  const leftParts = left ?? [];
  const rightParts = right ?? [];

  return leftParts.length === rightParts.length &&
    leftParts.every((part, index) => areTranscriptPartEqual(part, rightParts[index]));
}

export function areAgentTranscriptEntriesEqual(
  left: AgentTranscriptEntry,
  right: AgentTranscriptEntry
) {
  return (
    left === right ||
    (
      left.id === right.id &&
      left.timestamp === right.timestamp &&
      left.role === right.role &&
      left.text === right.text &&
      left.phase === right.phase &&
      left.isCompact === right.isCompact &&
      left.sourceEntryCount === right.sourceEntryCount &&
      areStringArraysEqual(left.sourceEntryIds, right.sourceEntryIds) &&
      areSourceEntryRangesEqual(left.sourceEntryRanges, right.sourceEntryRanges) &&
      areSourceEntryRangesEqual(left.sourceEntrySpans, right.sourceEntrySpans) &&
      areTranscriptPartsEqual(left.parts, right.parts)
    )
  );
}

export function mergeTranscriptEntryReference<TEntry extends AgentTranscriptEntry | null>(
  current: TEntry | undefined,
  next: TEntry
) {
  if (current && next && areAgentTranscriptEntriesEqual(current, next)) return current;

  return next;
}

function mergeTranscriptEntryReferences(
  current: AgentTranscriptEntry[],
  next: AgentTranscriptEntry[]
) {
  const currentEntriesById = new Map(
    current.map((entry) => [entry.id, entry])
  );
  let hasChanges = current.length !== next.length;
  const entries = next.map((entry, entryIndex) => {
    const mergedEntry = mergeTranscriptEntryReference(
      currentEntriesById.get(entry.id),
      entry
    );

    if (mergedEntry !== current[entryIndex]) hasChanges = true;
    return mergedEntry;
  });

  return hasChanges ? entries : current;
}

export function mergeTranscriptActivityGroup(
  current: AgentTranscriptActivityGroup | undefined,
  next: AgentTranscriptActivityGroup
): AgentTranscriptActivityGroup {
  if (
    !current ||
    current.id !== next.id ||
    current.kind !== next.kind ||
    current.label !== next.label ||
    current.timestamp !== next.timestamp ||
    current.sourceEntryCount !== next.sourceEntryCount ||
    !areStringArraysEqual(current.entryIds, next.entryIds) ||
    !areStringArraysEqual(current.sourceEntryIds, next.sourceEntryIds) ||
    !areSourceEntryRangesEqual(current.sourceEntryRanges, next.sourceEntryRanges) ||
    !areSourceEntryRangesEqual(current.sourceEntrySpans, next.sourceEntrySpans)
  ) {
    return next;
  }

  const entries = mergeTranscriptEntryReferences(current.entries, next.entries);

  return entries === current.entries ? current : { ...next, entries };
}

export function mergeTranscriptActivityGroups(
  currentGroups: AgentTranscriptActivityGroup[],
  nextGroups: AgentTranscriptActivityGroup[]
) {
  const currentGroupsById = new Map(
    currentGroups.map((group) => [group.id, group])
  );
  let hasChanges = currentGroups.length !== nextGroups.length;
  const groups = nextGroups.map((group, groupIndex) => {
    const mergedGroup = mergeTranscriptActivityGroup(
      currentGroupsById.get(group.id),
      group
    );

    if (mergedGroup !== currentGroups[groupIndex]) hasChanges = true;
    return mergedGroup;
  });

  return hasChanges ? groups : currentGroups;
}

export function areAgentSessionSummariesEqual(
  left: AgentSessionSummary | undefined,
  right: AgentSessionSummary | undefined
) {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.id === right.id &&
    left.agentId === right.agentId &&
    left.agentLabel === right.agentLabel &&
    left.sourceSessionId === right.sourceSessionId &&
    left.title === right.title &&
    left.workspacePath === right.workspacePath &&
    left.workspaceName === right.workspaceName &&
    left.updatedAt === right.updatedAt &&
    left.model === right.model &&
    left.originator === right.originator &&
    left.cliVersion === right.cliVersion &&
    left.source === right.source &&
    left.filePath === right.filePath &&
    left.contextCompactionCount === right.contextCompactionCount &&
    left.approvalPolicy === right.approvalPolicy &&
    left.sandboxMode === right.sandboxMode &&
    left.attachMode === right.attachMode &&
    left.attachModeReason === right.attachModeReason &&
    left.reviewedAt === right.reviewedAt &&
    left.workState === right.workState &&
    areObservedTurnStatesEqual(left.turnState, right.turnState) &&
    areInterruptLifecyclesEqual(left, right)
  );
}

export function areTranscriptTurnStatusesEqual(
  left: AgentTranscriptTurnStatus | null,
  right: AgentTranscriptTurnStatus | null
) {
  if (left === right) return true;
  if (!left || !right) return false;

  return (
    left.kind === right.kind &&
    left.label === right.label &&
    left.title === right.title
  );
}

export function areSameTranscriptEntryReferences(
  left: AgentTranscriptEntry[],
  right: AgentTranscriptEntry[]
) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
