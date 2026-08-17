import type {
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTranscriptEntry
} from "@deskcue/protocol";
import {
  deriveSourceAgentTurnState,
  findSourceAgentTerminalTurns
} from "#agents/sourceAgentTurnState";
import type { SourceAgentTurnState } from "#agents/sourceAgentTurnState";
import type { DaemonApplication } from "#application/daemonApplication";

import { AgentSessionSourceTracker } from "./agentSessionSourceTracker.ts";
import { AgentSessionTurnStateRepository } from "./agentSessionTurnStateRepository.ts";
import type { TrackedAgentSessionTurnState } from "./agentSessionTurnStateRepository.ts";

function shouldSuppressManagedAttachedTurn(
  application: DaemonApplication,
  agentSession: AgentSessionDetail,
  previousOwner: TrackedAgentSessionTurnState["owner"],
  owner: TrackedAgentSessionTurnState["owner"]
) {
  if (previousOwner !== "managed" && owner !== "managed") {
    return false;
  }

  return !application.managedSessions.listSessions().some(
    (session) =>
      session.status === "running" &&
      session.adapterId === agentSession.agentId &&
      session.sourceSessionId === agentSession.sourceSessionId
  );
}

function shouldPublishTurnFinishedEvent(
  application: DaemonApplication,
  agentSession: AgentSessionDetail,
  previous: TrackedAgentSessionTurnState | undefined,
  owner: TrackedAgentSessionTurnState["owner"]
) {
  if (!previous) {
    return false;
  }

  if (previous.state.phase === "active") {
    return true;
  }

  if (owner === "external") {
    // A short external turn can start and finish between two file polls. A
    // terminal lifecycle entry is enough once the session has a baseline.
    return true;
  }

  return application.managedSessions.listSessions().some(
    (session) =>
      session.status === "running" &&
      session.adapterId === agentSession.agentId &&
      session.sourceSessionId === agentSession.sourceSessionId
  );
}

function findNewTerminalTurns(
  terminalTurns: ReturnType<typeof findSourceAgentTerminalTurns>,
  previous: TrackedAgentSessionTurnState | undefined
) {
  if (!previous) {
    // The first bounded read establishes a baseline; it must not produce
    // notifications for old history.
    return [];
  }

  const observedFingerprints = previous.observedTerminalFingerprints;
  if (observedFingerprints) {
    const observed = new Set(observedFingerprints);
    return terminalTurns.filter((turn) => !observed.has(turn.fingerprint));
  }

  // Upgrade compatibility for state written before terminal fingerprints were
  // persisted. Restrict to entries newer than the last observation so a
  // daemon upgrade does not replay historical notifications.
  const previousObservedAt = Date.parse(previous.observedAt);
  if (!Number.isFinite(previousObservedAt)) {
    return [];
  }
  return terminalTurns.filter((turn) => Date.parse(turn.completedAt) > previousObservedAt);
}

function retainTerminalFingerprints(
  terminalTurns: ReturnType<typeof findSourceAgentTerminalTurns>
) {
  return terminalTurns.map((turn) => turn.fingerprint).slice(-64);
}

function readTurnStartedAt(state: SourceAgentTurnState) {
  return state.phase === "active" ? state.startedAt : null;
}

function truncateNotificationAnswer(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 320 ? `${normalized.slice(0, 319)}...` : normalized;
}

function findLatestTurnAnswer(
  transcript: AgentTranscriptEntry[],
  startedFingerprint: string,
  completedFingerprint: string
) {
  const startedIndex = transcript.findIndex((entry) => entry.id === startedFingerprint);
  const completedIndex = transcript.findIndex((entry) => entry.id === completedFingerprint);
  const start = startedIndex >= 0 ? startedIndex + 1 : 0;
  const end = completedIndex >= 0 ? completedIndex : transcript.length;

  for (let index = end - 1; index >= start; index -= 1) {
    const entry = transcript[index];
    if (entry.role !== "assistant") {
      continue;
    }

    const text = entry.text.trim();
    if (text) {
      return truncateNotificationAnswer(text);
    }
  }

  return null;
}

function findTurnStartedAt(
  transcript: AgentTranscriptEntry[],
  completedFingerprint: string
) {
  const completedIndex = transcript.findIndex((entry) => entry.id === completedFingerprint);
  const end = completedIndex >= 0 ? completedIndex : transcript.length;

  for (let index = end - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (entry.role !== "system") {
      continue;
    }

    const statusPart = entry.parts?.find((part) => part.type === "status");
    const label = statusPart?.type === "status" ? statusPart.label : entry.text;
    if (label === "Turn started") {
      return entry.timestamp;
    }
  }

  return null;
}

function findTurnDurationMs(
  transcript: AgentTranscriptEntry[],
  completedFingerprint: string
) {
  const completedEntry = transcript.find((entry) => entry.id === completedFingerprint);
  if (!completedEntry) {
    return null;
  }

  const statusPart = completedEntry.parts?.find((part) => part.type === "status");
  const detail =
    statusPart?.type === "status" ? statusPart.detail : completedEntry.text;
  if (!detail) {
    return null;
  }

  const completedMatch = detail.match(/\bCompleted in (\d+)s\b/);
  if (completedMatch?.[1]) {
    return Number(completedMatch[1]) * 1000;
  }

  const interruptedMatch = detail.match(/\bafter (\d+)s\b/);
  if (interruptedMatch?.[1]) {
    return Number(interruptedMatch[1]) * 1000;
  }

  return null;
}

export class AgentSessionTurnEventProjector {
  constructor(
    private readonly application: DaemonApplication,
    private readonly sourceTracker: AgentSessionSourceTracker,
    private readonly turnStates: AgentSessionTurnStateRepository
  ) {}

  shouldTrack(
    _session: AgentSessionSummary,
    _previousState: SourceAgentTurnState | undefined
  ) {
    // A source chat normally reports attachMode "resume" even when DeskCue
    // only observes it. Tracking must continue after a terminal turn: the
    // next external prompt otherwise finishes silently because the previous
    // state is no longer active.
    return true;
  }

  async update(
    agentSession: AgentSessionDetail,
    owner: TrackedAgentSessionTurnState["owner"]
  ) {
    const previous = this.turnStates.get(agentSession.id);
    const nextState = deriveSourceAgentTurnState(agentSession);
    const terminalTurns = findSourceAgentTerminalTurns(agentSession.transcript);
    const newTerminalTurns = findNewTerminalTurns(terminalTurns, previous);
    const transcriptEvents = this.publishTranscriptUpdatedIfChanged(agentSession);
    this.turnStates.set(agentSession.id, {
      observedAt: new Date().toISOString(),
      observedTerminalFingerprints: retainTerminalFingerprints(terminalTurns),
      owner,
      state: nextState
    });

    const shouldPublishTurnFinished = shouldPublishTurnFinishedEvent(
      this.application,
      agentSession,
      previous,
      owner
    );

    if (
      !previous ||
      newTerminalTurns.length === 0 ||
      !shouldPublishTurnFinished ||
      shouldSuppressManagedAttachedTurn(
        this.application,
        agentSession,
        previous.owner,
        owner
      )
    ) {
      return {
        transcriptEvents,
        turnEvents: 0
      };
    }

    for (const terminalTurn of newTerminalTurns) {
      this.application.events.publishServerEvent({
        type: "agent.session.turn.finished",
        payload: {
          agentId: agentSession.agentId,
          agentLabel: agentSession.agentLabel,
          agentSessionId: agentSession.id,
          answer: findLatestTurnAnswer(
            agentSession.transcript,
            terminalTurn.turnStartFingerprint ?? previous.state.fingerprint ?? "",
            terminalTurn.fingerprint
          ),
          completedAt: terminalTurn.completedAt,
          durationMs: findTurnDurationMs(agentSession.transcript, terminalTurn.fingerprint),
          sourceSessionId: agentSession.sourceSessionId,
          startedAt:
            terminalTurn.turnStartFingerprint
              ? findTurnStartedAt(agentSession.transcript, terminalTurn.fingerprint)
              : readTurnStartedAt(previous.state),
          status: terminalTurn.phase,
          title: agentSession.title,
          workspaceName: agentSession.workspaceName,
          workspacePath: agentSession.workspacePath
        }
      });
    }

    // The notification coordinator durably claims its outbox record while the
    // event is being published. Persist the observation cursor afterwards: if
    // the daemon crashes in between, the source terminal entry is observed
    // again after restart and the notification outbox dedupe prevents a
    // duplicate delivery instead of losing the notification.
    await this.turnStates.persist();

    return {
      transcriptEvents,
      turnEvents: newTerminalTurns.length
    };
  }

  private publishTranscriptUpdatedIfChanged(agentSession: AgentSessionDetail) {
    const change = this.sourceTracker.readTranscriptChange(
      agentSession.transcript,
      agentSession.id
    );
    if (!change.changed) {
      return 0;
    }

    this.application.events.publishServerEvent({
      type: "agent.session.transcript.updated",
      payload: {
        agentId: agentSession.agentId,
        agentLabel: agentSession.agentLabel,
        agentSessionId: agentSession.id,
        latestEntryId: change.signature.latestEntryId,
        sourceSessionId: agentSession.sourceSessionId,
        transcriptLength: change.signature.length,
        ...(agentSession.turnState ? { turnState: agentSession.turnState } : {}),
        updatedAt: agentSession.updatedAt,
        workState: agentSession.workState
      }
    });
    return 1;
  }
}
