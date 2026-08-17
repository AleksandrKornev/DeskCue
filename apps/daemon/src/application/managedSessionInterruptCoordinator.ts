import type { AgentSessionDetail, ExternalForceStopTarget, SessionDetail } from "@deskcue/protocol";

import { AppError } from "./errors.ts";
import type {
  ManagedSessionBackend,
  SourceAgentSessionDiscovery,
  SourceTurnInterruptTarget
} from "./ports.ts";

const MANAGED_INTERRUPT_TRANSCRIPT_TAIL = 160;

function unverifiedDesktopChatError() {
  return new AppError(
    "not_accepting_input",
    "DeskCue can only open a confirmed external Codex Desktop chat."
  );
}

function readInterruptibleManagedPrompt(session: SessionDetail) {
  const replyState = session.replyState;
  if (!replyState) {
    return null;
  }
  const { phase, promptText, requestedAt } = replyState;
  if (
    (phase !== "sending" && phase !== "waiting") ||
    !promptText?.trim() ||
    !requestedAt
  ) {
    return null;
  }
  const requestedAtMs = Date.parse(requestedAt);
  if (!Number.isFinite(requestedAtMs)) {
    return null;
  }
  return { promptText: promptText.trim(), requestedAtMs };
}

function findOwnedActiveUserEntry(
  transcript: AgentSessionDetail["transcript"],
  activeTurnFingerprint: string,
  pendingPrompt: { promptText: string; requestedAtMs: number }
) {
  const activeTurnIndex = transcript.findIndex((entry) => entry.id === activeTurnFingerprint);
  if (activeTurnIndex < 0) {
    return null;
  }

  const matchingUserEntry = [...transcript].reverse().find((entry) => {
    if (entry.role !== "user" || entry.text.trim() !== pendingPrompt.promptText) {
      return false;
    }
    const entryTimestamp = Date.parse(entry.timestamp);
    return Number.isFinite(entryTimestamp) && entryTimestamp >= pendingPrompt.requestedAtMs - 15_000;
  });
  if (!matchingUserEntry) {
    return null;
  }

  const userIndex = transcript.findIndex((entry) => entry.id === matchingUserEntry.id);
  if (userIndex < 0 || userIndex > activeTurnIndex) {
    return null;
  }
  for (let index = userIndex + 1; index < activeTurnIndex; index += 1) {
    const entry = transcript[index];
    const status = entry.parts?.find((part) => part.type === "status");
    const label = status?.type === "status" ? status.label : entry.text;
    if (
      entry.role === "system" &&
      (label === "Turn completed" || label === "Turn failed" || label === "Turn interrupted")
    ) {
      return null;
    }
  }
  return matchingUserEntry;
}

export class ManagedSessionInterruptCoordinator {
  constructor(
    private readonly backend: ManagedSessionBackend,
    private readonly discovery: SourceAgentSessionDiscovery
  ) {}

  async interruptSession(sessionId: string): Promise<SessionDetail> {
    const session = this.backend.getSession(sessionId);
    const sourceTurn = session ? await this.readActiveSourceTurn(session) : null;

    try {
      return await this.backend.interruptSession(sessionId, sourceTurn);
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "not_accepting_input" &&
        sourceTurn &&
        session &&
        await this.isVerifiedExternalCodexDesktopChat(session)
      ) {
        throw new AppError(
          "external_desktop_interrupt_unavailable",
          "DeskCue cannot interrupt this Codex Desktop chat directly."
        );
      }
      throw error;
    }
  }

  async interruptExternalDesktopSession(sessionId: string): Promise<SessionDetail> {
    const session = this.backend.getSession(sessionId);
    const sourceTurn = session ? await this.readActiveSourceTurn(session) : null;
    return this.backend.interruptExternalDesktopSession(sessionId, sourceTurn);
  }

  async forceStopExternalProcess(
    sessionId: string,
    target: ExternalForceStopTarget
  ): Promise<SessionDetail> {
    const session = this.backend.getSession(sessionId);
    const sourceTurn = session ? await this.readActiveSourceTurn(session) : null;
    return this.backend.forceStopExternalProcess(sessionId, target, sourceTurn);
  }

  async openExternalCodexDesktopChat(sessionId: string): Promise<void> {
    const session = this.backend.getSession(sessionId);
    if (session?.adapterId !== "codex" || !session.sourceSessionId) {
      throw unverifiedDesktopChatError();
    }
    if (!await this.isVerifiedExternalCodexDesktopChat(session)) {
      throw unverifiedDesktopChatError();
    }
    await this.backend.openExternalCodexDesktopChat(sessionId);
  }

  private async readActiveSourceTurn(
    session: SessionDetail
  ): Promise<SourceTurnInterruptTarget | null> {
    if (!session.sourceSessionId) {
      return null;
    }

    const pendingPrompt = readInterruptibleManagedPrompt(session);
    const agentSession = await this.discovery.getSessionDetailForManagedSession(
      session,
      MANAGED_INTERRUPT_TRANSCRIPT_TAIL
    );
    const turnState = agentSession?.turnState;
    if (
      !agentSession ||
      turnState?.phase !== "active" ||
      !turnState.fingerprint ||
      !turnState.startedAt
    ) {
      return null;
    }

    // Non-managed/external control callers do not have a DeskCue prompt to
    // match. Preserve their source-turn identity; only a managed prompt is
    // required to prove the user entry before its lifecycle can be projected.
    if (!pendingPrompt) {
      return {
        fingerprint: turnState.fingerprint,
        startedAt: turnState.startedAt
      };
    }

    const userEntry = findOwnedActiveUserEntry(
      agentSession.transcript,
      turnState.fingerprint,
      pendingPrompt
    );
    if (!userEntry) {
      // A stale source read must never attach an interrupt lifecycle marker to
      // an earlier turn. The transport can still be stopped safely; only the
      // source-backed projection waits until it can prove prompt ownership.
      return null;
    }

    return {
      fingerprint: turnState.fingerprint,
      startedAt: turnState.startedAt,
      userEntryId: userEntry.id
    };
  }

  private async isVerifiedExternalCodexDesktopChat(session: SessionDetail) {
    if (session.adapterId !== "codex" || !session.sourceSessionId) {
      return false;
    }
    const agentSession = await this.discovery.getSessionDetailForManagedSession(session, 0, 0);
    return (
      agentSession?.agentId === "codex" &&
      agentSession.sourceSessionId === session.sourceSessionId &&
      agentSession.originator === "Codex Desktop" &&
      agentSession.source === "vscode"
    );
  }
}
