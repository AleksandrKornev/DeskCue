import type { AgentSessionDetail, ExternalForceStopTarget, SessionDetail } from "@deskcue/protocol";
import {
  findOwnedActiveSourceTurn,
  isActiveSourceTurnAlreadyInterrupted
} from "#agents/managedSourceTurnOwnership";

import { AppError } from "./errors.ts";
import type {
  ManagedSessionBackend,
  ManagedSourceAgentSessionDiscovery,
  SourceTurnInterruptTarget
} from "./ports.ts";

const MANAGED_INTERRUPT_TRANSCRIPT_TAIL = 160;
const MANAGED_INTERRUPT_CHAT_MESSAGE_TAIL = 8;

function unverifiedDesktopChatError() {
  return new AppError(
    "not_accepting_input",
    "DeskCue can only open a confirmed external Codex Desktop chat."
  );
}

function readInterruptibleManagedPrompt(session: SessionDetail) {
  const replyState = session.replyState;

  if (!replyState) return null;

  const { phase, promptText, requestedAt } = replyState;

  if (
    (phase !== "sending" && phase !== "waiting") ||
    !promptText?.trim() ||
    !requestedAt
  ) {
    return null;
  }

  const requestedAtMs = Date.parse(requestedAt);

  if (!Number.isFinite(requestedAtMs)) return null;

  return { promptText: promptText.trim(), requestedAtMs };
}

export class ManagedSessionInterruptCoordinator {
  constructor(
    private readonly backend: ManagedSessionBackend,
    private readonly discovery: ManagedSourceAgentSessionDiscovery
  ) {}

  async interruptSession(sessionId: string): Promise<SessionDetail> {
    const session = this.backend.getSession(sessionId);
    const sourceTurnContext = session ? await this.readActiveSourceTurn(session) : null;
    const sourceTurn = sourceTurnContext?.target ?? null;

    try {
      return await this.backend.interruptSession(
        sessionId,
        sourceTurn,
        sourceTurnContext?.agentSession ?? null
      );
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
    const sourceTurn = session ? (await this.readActiveSourceTurn(session))?.target ?? null : null;

    return this.backend.interruptExternalDesktopSession(sessionId, sourceTurn);
  }

  async forceStopExternalProcess(
    sessionId: string,
    target: ExternalForceStopTarget
  ): Promise<SessionDetail> {
    const session = this.backend.getSession(sessionId);
    const sourceTurn = session ? (await this.readActiveSourceTurn(session))?.target ?? null : null;

    return this.backend.forceStopExternalProcess(sessionId, target, sourceTurn);
  }

  async openExternalCodexDesktopChat(sessionId: string): Promise<void> {
    const session = this.backend.getSession(sessionId);

    if (session?.adapterId !== "codex" || !session.sourceSessionId) throw unverifiedDesktopChatError();
    if (!await this.isVerifiedExternalCodexDesktopChat(session)) throw unverifiedDesktopChatError();

    await this.backend.openExternalCodexDesktopChat(sessionId);
  }

  private async readActiveSourceTurn(
    session: SessionDetail
  ): Promise<{
    agentSession: AgentSessionDetail;
    target: SourceTurnInterruptTarget;
  } | null> {
    if (!session.sourceSessionId) return null;

    const pendingPrompt = readInterruptibleManagedPrompt(session);
    const agentSession = await this.discovery.getSessionDetailForManagedSession(
      session,
      MANAGED_INTERRUPT_TRANSCRIPT_TAIL,
      MANAGED_INTERRUPT_CHAT_MESSAGE_TAIL
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

    if (isActiveSourceTurnAlreadyInterrupted(agentSession)) return null;

    // Non-managed/external control callers do not have a DeskCue prompt to
    // match. Preserve their source-turn identity; only a managed prompt is
    // required to prove the user entry before its lifecycle can be projected.
    if (!pendingPrompt) {
      return {
        agentSession,
        target: {
          fingerprint: turnState.fingerprint,
          startedAt: turnState.startedAt
        }
      };
    }

    const target = findOwnedActiveSourceTurn(agentSession, pendingPrompt);

    if (!target) {
      // A stale source read must never attach an interrupt lifecycle marker to
      // an earlier turn. The transport can still be stopped safely; only the
      // source-backed projection waits until it can prove prompt ownership.
      return null;
    }

    return {
      agentSession,
      target
    };
  }

  private async isVerifiedExternalCodexDesktopChat(session: SessionDetail) {
    if (session.adapterId !== "codex" || !session.sourceSessionId) return false;

    const agentSession = await this.discovery.getSessionDetailForManagedSession(session, 0, 0);

    return (
      agentSession?.agentId === "codex" &&
      agentSession.sourceSessionId === session.sourceSessionId &&
      agentSession.originator === "Codex Desktop" &&
      agentSession.source === "vscode"
    );
  }
}
