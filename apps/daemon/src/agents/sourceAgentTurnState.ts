import type { AgentSessionDetail, AgentTranscriptEntry } from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";

export type SourceAgentTurnState =
  | {
      evidence: "none";
      phase: "idle";
      fingerprint: string | null;
    }
  | {
      activityAt: string;
      evidence:
        | "recent_non_final_activity"
        | "turn_lifecycle"
        | "unanswered_user_turn"
        | "user_after_terminal";
      fingerprint: string;
      phase: "active";
      startedAt: string;
    }
  | {
      completedAt: string;
      evidence: "terminal_lifecycle";
      fingerprint: string;
      phase: "completed" | "failed" | "interrupted";
      turnStartFingerprint: string | null;
    };

export type SourceAgentTerminalTurn = Extract<
  SourceAgentTurnState,
  { phase: "completed" | "failed" | "interrupted" }
>;

function readLifecycleLabel(entry: AgentTranscriptEntry) {
  if (entry.role !== "system") return null;

  const statusPart = entry.parts?.find((part) => part.type === "status");
  const label = statusPart?.type === "status" ? statusPart.label : entry.text;

  if (
    label === "Turn started" ||
    label === "Turn completed" ||
    label === "Turn failed" ||
    label === "Turn interrupted"
  ) {
    return label;
  }

  return null;
}

function isTerminalLifecycleLabel(label: ReturnType<typeof readLifecycleLabel>) {
  return label === "Turn completed" || label === "Turn failed" || label === "Turn interrupted";
}

function isStaleTurn(startedAt: string, latestActivityAt: string | null) {
  const referenceTimestamp = latestActivityAt ?? startedAt;
  const referenceTime = Date.parse(referenceTimestamp);

  if (Number.isNaN(referenceTime)) return false;

  return Date.now() - referenceTime > daemonConfig.sourceAgentActiveTurnStaleMs;
}

function isNonFinalAssistantEntry(entry: AgentTranscriptEntry) {
  return entry.role === "assistant" && entry.phase === "non_final";
}

function isFreshNonFinalActivity(entry: AgentTranscriptEntry) {
  if (entry.role === "assistant" && !isNonFinalAssistantEntry(entry)) return false;

  return !isStaleTurn(entry.timestamp, entry.timestamp);
}

function findLatestUnansweredUserTurn(
  entries: AgentTranscriptEntry[],
  afterIndex = -1
) {
  let latestActivityEntry: AgentTranscriptEntry | null = null;

  for (let index = entries.length - 1; index > afterIndex; index -= 1) {
    const entry = entries[index];

    latestActivityEntry ??= entry;

    const label = readLifecycleLabel(entry);

    if (isTerminalLifecycleLabel(label) || label === "Turn started") return null;
    if (entry.role === "assistant" && !isNonFinalAssistantEntry(entry)) return null;

    if (entry.role === "user") {
      return {
        activityAt: latestActivityEntry.timestamp,
        userEntry: entry
      };
    }
  }

  return null;
}

function findMatchingTurnStart(entries: AgentTranscriptEntry[], terminalIndex: number) {
  for (let index = terminalIndex - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const label = readLifecycleLabel(entry);

    if (label === "Turn started" || entry.role === "user") return entry;
    if (isTerminalLifecycleLabel(label)) return null;
  }

  return null;
}

/**
 * Returns every terminal lifecycle entry in the supplied bounded transcript
 * window. This intentionally differs from `deriveSourceAgentTurnState`: the
 * latter describes only the current turn, while realtime delivery also needs
 * to observe a completion that was immediately followed by another turn.
 */
export function findSourceAgentTerminalTurns(
  transcript: AgentTranscriptEntry[]
): SourceAgentTerminalTurn[] {
  const terminalTurns: SourceAgentTerminalTurn[] = [];

  for (let index = 0; index < transcript.length; index += 1) {
    const entry = transcript[index];
    const label = readLifecycleLabel(entry);

    if (!isTerminalLifecycleLabel(label)) continue;

    terminalTurns.push({
      completedAt: entry.timestamp,
      evidence: "terminal_lifecycle",
      fingerprint: entry.id,
      phase: label === "Turn failed"
        ? "failed"
        : label === "Turn interrupted"
          ? "interrupted"
          : "completed",
      turnStartFingerprint: findMatchingTurnStart(transcript, index)?.id ?? null
    });
  }

  return terminalTurns;
}

function toUnansweredUserTurnState(
  turn: NonNullable<ReturnType<typeof findLatestUnansweredUserTurn>>,
  terminalEntry?: AgentTranscriptEntry
): Extract<SourceAgentTurnState, { phase: "active" }> {
  const isFreshUserAfterTerminal =
    terminalEntry &&
    turn.activityAt === turn.userEntry.timestamp &&
    turn.userEntry.timestamp > terminalEntry.timestamp &&
    !isStaleTurn(turn.userEntry.timestamp, turn.activityAt);

  return {
    activityAt: turn.activityAt,
    evidence: isFreshUserAfterTerminal ? "user_after_terminal" : "unanswered_user_turn",
    fingerprint: turn.userEntry.id,
    phase: "active",
    startedAt: turn.userEntry.timestamp
  };
}

export function deriveSourceAgentTurnState(
  session: Pick<AgentSessionDetail, "transcript">
): SourceAgentTurnState {
  let latestActivityTimestamp: string | null = null;
  let latestEntry: AgentTranscriptEntry | null = null;

  for (let index = session.transcript.length - 1; index >= 0; index -= 1) {
    const entry = session.transcript[index];

    if (!latestActivityTimestamp) {
      latestActivityTimestamp = entry.timestamp;
      latestEntry = entry;
    }

    const label = readLifecycleLabel(entry);

    if (!label) continue;

    if (label === "Turn completed" || label === "Turn failed") {
      const newUserTurn = findLatestUnansweredUserTurn(session.transcript, index);

      if (newUserTurn) return toUnansweredUserTurnState(newUserTurn, entry);

      return {
        completedAt: entry.timestamp,
        evidence: "terminal_lifecycle",
        fingerprint: entry.id,
        phase: label === "Turn failed" ? "failed" : "completed",
        turnStartFingerprint: findMatchingTurnStart(session.transcript, index)?.id ?? null
      };
    }

    if (label === "Turn interrupted") {
      const newUserTurn = findLatestUnansweredUserTurn(session.transcript, index);

      if (newUserTurn) return toUnansweredUserTurnState(newUserTurn, entry);

      return {
        completedAt: entry.timestamp,
        evidence: "terminal_lifecycle",
        fingerprint: entry.id,
        phase: "interrupted",
        turnStartFingerprint: findMatchingTurnStart(session.transcript, index)?.id ?? null
      };
    }

    if (label === "Turn started") {
      if (isStaleTurn(entry.timestamp, latestActivityTimestamp)) {
        return {
          evidence: "none",
          fingerprint: null,
          phase: "idle"
        };
      }

      return {
        activityAt: latestActivityTimestamp,
        evidence: "turn_lifecycle",
        fingerprint: entry.id,
        phase: "active",
        startedAt: entry.timestamp
      };
    }
  }

  const unansweredUserTurn = findLatestUnansweredUserTurn(session.transcript);

  if (unansweredUserTurn) return toUnansweredUserTurnState(unansweredUserTurn);

  if (latestEntry && isFreshNonFinalActivity(latestEntry)) {
    return {
      activityAt: latestEntry.timestamp,
      evidence: "recent_non_final_activity",
      fingerprint: latestEntry.id,
      phase: "active",
      startedAt: latestEntry.timestamp
    };
  }

  return {
    evidence: "none",
    fingerprint: null,
    phase: "idle"
  };
}
