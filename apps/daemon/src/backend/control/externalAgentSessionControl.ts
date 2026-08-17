import { claudeCodeAdapter, codexAdapter } from "@deskcue/adapters";
import type {
  ExternalClaudeBackgroundStopCapability,
  ExternalDesktopInterruptCapability,
  ExternalForceStopCapability,
  ExternalForceStopTarget,
  SessionDetail
} from "@deskcue/protocol";
import {
  requestClaudeBackgroundStop,
  resolveClaudeBackgroundControlCapability
} from "#agents/claude/processControl/claudeBackgroundControl";
import {
  canTakeOverStoppedExternalClaudeSession
} from "#agents/claude/processControl/claudeExternalTakeover";
import {
  getSourceAgentExternalProcessControl
} from "#agents/control/externalProcess/sourceAgentExternalProcessControlRegistry";
import type {
  SourceTurnInterruptLifecycle,
  SourceTurnInterruptTarget
} from "#agents/sourceTurnInterruptLifecycle";
import { AppError } from "#application/errors";

export const externalAgentSessionRuntime = {
  canTakeOverStoppedExternalClaudeSession,
  getSourceAgentExternalProcessControl,
  requestClaudeBackgroundStop,
  resolveClaudeBackgroundControlCapability
};

export type ExternalAgentSessionRuntime = typeof externalAgentSessionRuntime;

export type ExternalAgentSessionControlDependencies = {
  appendSystemLog: (sessionId: string, text: string) => void;
  getSession: (sessionId: string) => SessionDetail | null;
  hasManagedChild: (sessionId: string) => boolean;
  openCodexDesktopThread: (sourceSessionId: string) => Promise<void>;
  persistState: () => Promise<void>;
  runtime: ExternalAgentSessionRuntime;
  sourceTurnInterrupts: SourceTurnInterruptLifecycle;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

function unavailable(reason: string) {
  return {
    kind: "unavailable" as const,
    reason
  };
}

export class ExternalAgentSessionControl {
  constructor(private readonly dependencies: ExternalAgentSessionControlDependencies) {}

  async getForceStopCapability(sessionId: string): Promise<ExternalForceStopCapability> {
    const session = this.getExternalSession(sessionId);
    if (!session) return unavailable("not_external_agent_session");

    const processControl = this.dependencies.runtime.getSourceAgentExternalProcessControl(
      session.adapterId
    );
    if (processControl) return processControl.getForceStopCapability(session.sourceSessionId);

    return unavailable("not_external_agent_session");
  }

  async getDesktopInterruptCapability(
    sessionId: string
  ): Promise<ExternalDesktopInterruptCapability> {
    const session = this.getExternalSession(sessionId, codexAdapter.id);
    if (!session) return unavailable("not_external_codex_session");

    // Codex Desktop does not expose a verified per-chat interrupt transport.
    return unavailable("desktop_interrupt_not_supported");
  }

  async openCodexDesktopChat(sessionId: string): Promise<void> {
    const session = this.requireExternalSession(
      sessionId,
      codexAdapter.id,
      "DeskCue can only open an external Codex Desktop chat."
    );

    try {
      await this.dependencies.openCodexDesktopThread(session.sourceSessionId);
    } catch {
      throw new AppError(
        "runtime_unavailable",
        "DeskCue could not request Codex Desktop to open this chat."
      );
    }
  }

  async getClaudeBackgroundStopCapability(
    sessionId: string
  ): Promise<ExternalClaudeBackgroundStopCapability> {
    const session = this.getExternalSession(sessionId, claudeCodeAdapter.id);
    if (!session) return unavailable("not_external_claude_session");

    const capability = await this.dependencies.runtime.resolveClaudeBackgroundControlCapability(
      session.sourceSessionId
    );
    if (capability.kind !== "claude_background_stop") return unavailable(capability.reason);

    return {
      kind: "available",
      jobId: capability.jobId,
      state: capability.state
    };
  }

  async stopClaudeBackground(sessionId: string): Promise<SessionDetail> {
    const session = this.requireExternalSession(
      sessionId,
      claudeCodeAdapter.id,
      "DeskCue can stop only an external Claude Code background job with a verified session identity."
    );

    const result = await this.dependencies.runtime.requestClaudeBackgroundStop(
      session.sourceSessionId
    );
    if (result.kind === "control_unavailable") {
      throw new AppError(
        "not_accepting_input",
        "DeskCue could not find one interruptible Claude Code background job for this chat."
      );
    }
    if (result.kind === "stop_command_failed") {
      throw new AppError(
        "runtime_unavailable",
        "Claude Code could not stop the verified background job."
      );
    }

    this.dependencies.appendSystemLog(
      session.id,
      `Stop requested for external Claude Code background job ${result.jobId}. Waiting for source confirmation.\n`
    );
    await this.dependencies.persistState();

    return this.requireCurrentSession(session.id);
  }

  async forceStopProcess(
    sessionId: string,
    target: ExternalForceStopTarget,
    sourceTurn?: SourceTurnInterruptTarget | null
  ): Promise<SessionDetail> {
    const session = this.dependencies.getSession(sessionId);
    if (!session) throw new AppError("not_found", "Session not found.");
    if (!session.sourceSessionId || this.dependencies.hasManagedChild(sessionId)) {
      throw new AppError(
        "not_accepting_input",
        "DeskCue can force stop only an external agent resume process with a verified session identity."
      );
    }

    const isClaude = session.adapterId === claudeCodeAdapter.id;
    const processControl = this.dependencies.runtime.getSourceAgentExternalProcessControl(
      session.adapterId
    );
    if (!processControl) {
      throw new AppError(
        "not_accepting_input",
        "DeskCue cannot verify an external process for this agent."
      );
    }

    if (isClaude) {
      const backgroundControl = await this.dependencies.runtime.resolveClaudeBackgroundControlCapability(
        session.sourceSessionId
      );
      if (backgroundControl.kind === "claude_background_stop") {
        throw new AppError(
          "not_accepting_input",
          "Use the verified Claude Code background stop command for this chat instead of terminating its worker process."
        );
      }
    }

    const result = await processControl.requestForceStop(session.sourceSessionId, target);
    const { agentLabel } = processControl;

    if (result.kind === "control_unavailable") {
      throw new AppError(
        "not_accepting_input",
        `DeskCue could not find one verified external ${agentLabel} process for this chat.`
      );
    }
    if (result.kind === "process_identity_changed") {
      throw new AppError(
        "conflict",
        `The external ${agentLabel} process changed before DeskCue could stop it.`
      );
    }
    if (result.kind === "stop_failed") {
      throw new AppError(
        "runtime_unavailable",
        `DeskCue could not stop the verified ${agentLabel} process.`
      );
    }

    const claudeTakeoverReady = isClaude && await this.releaseStoppedClaudeSession(session);
    this.dependencies.sourceTurnInterrupts.requestExternalForceStop(session, sourceTurn);
    this.dependencies.appendSystemLog(
      session.id,
      claudeTakeoverReady
        ? `External Claude Code process ${result.processId} stopped. DeskCue can now resume this chat.\n`
        : `Force stop requested for external ${agentLabel} process ${result.processId}. Waiting for source confirmation.\n`
    );
    await this.dependencies.persistState();

    return this.requireCurrentSession(session.id);
  }

  async interruptDesktopSession(
    sessionId: string,
    _sourceTurn?: SourceTurnInterruptTarget | null
  ): Promise<SessionDetail> {
    this.requireExternalSession(
      sessionId,
      codexAdapter.id,
      "DeskCue can interrupt only an observed external Codex Desktop chat."
    );

    throw new AppError(
      "not_accepting_input",
      "DeskCue cannot interrupt an external Codex Desktop chat until Codex Desktop exposes a verified per-chat control channel."
    );
  }

  private getExternalSession(sessionId: string, adapterId?: string) {
    const session = this.dependencies.getSession(sessionId);
    if (
      !session ||
      !session.sourceSessionId ||
      this.dependencies.hasManagedChild(sessionId) ||
      (adapterId !== undefined && session.adapterId !== adapterId)
    ) {
      return null;
    }
    return session as SessionDetail & { sourceSessionId: string };
  }

  private requireExternalSession(sessionId: string, adapterId: string, message: string) {
    const session = this.getExternalSession(sessionId, adapterId);
    if (!session) throw new AppError("not_accepting_input", message);
    return session;
  }

  private requireCurrentSession(sessionId: string) {
    const session = this.dependencies.getSession(sessionId);
    if (!session) throw new AppError("not_found", "Session not found.");
    return session;
  }

  private async releaseStoppedClaudeSession(session: SessionDetail) {
    if (
      session.adapterId !== claudeCodeAdapter.id ||
      !session.sourceSessionId ||
      !session.command.endsWith(" (observe-only)")
    ) {
      return false;
    }

    if (!await this.dependencies.runtime.canTakeOverStoppedExternalClaudeSession(
      session.sourceSessionId
    )) {
      return false;
    }

    this.dependencies.updateSession(session.id, {
      command: `claude --resume ${session.sourceSessionId} (read-only)`,
      lastActivityAt: new Date().toISOString()
    });
    return true;
  }
}
