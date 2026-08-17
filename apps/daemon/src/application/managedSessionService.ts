import type {
  CapturePreviewArtifactPayload,
  CreateSessionInput,
  ExternalClaudeBackgroundStopCapability,
  ExternalDesktopInterruptCapability,
  ExternalForceStopCapability,
  ExternalForceStopTarget,
  PreviewNetworkMode,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";

import { ManagedSessionInterruptCoordinator } from "./managedSessionInterruptCoordinator.ts";
import { ManagedSessionReplyStateSynchronizer } from "./managedSessionReplyStateSync.ts";
import type {
  ManagedSessionBackend,
  ManagedSessionGitRefreshOptions,
  SourceAgentSessionDiscovery
} from "./ports.ts";
import {
  requireNonEmptyString,
  validateCreateSessionInput,
  validatePreviewPort
} from "./serviceValidation.ts";

export class ManagedSessionService {
  private readonly interrupts: ManagedSessionInterruptCoordinator;
  private readonly replyStateSync: ManagedSessionReplyStateSynchronizer;

  constructor(
    private readonly backend: ManagedSessionBackend,
    discovery: SourceAgentSessionDiscovery
  ) {
    this.interrupts = new ManagedSessionInterruptCoordinator(backend, discovery);
    this.replyStateSync = new ManagedSessionReplyStateSynchronizer(backend, discovery);
  }

  listSessions(): SessionSummary[] {
    return this.backend.listSessions();
  }

  getSession(sessionId: string): SessionDetail | null {
    return this.backend.getSession(requireNonEmptyString(sessionId, "sessionId"));
  }

  startSession(input: CreateSessionInput): Promise<SessionDetail> {
    return this.backend.startSession(validateCreateSessionInput(input));
  }

  async sendInput(sessionId: string, input: string): Promise<SessionDetail> {
    const normalizedSessionId = requireNonEmptyString(sessionId, "sessionId");
    const session = await this.backend.sendInput(
      normalizedSessionId,
      requireNonEmptyString(input, "input")
    );
    return this.replyStateSync.startQueuedCodexPromptIfReady(normalizedSessionId, session);
  }

  stopSession(sessionId: string): Promise<SessionDetail> {
    return this.backend.stopSession(requireNonEmptyString(sessionId, "sessionId"));
  }

  interruptSession(sessionId: string): Promise<SessionDetail> {
    return this.interrupts.interruptSession(requireNonEmptyString(sessionId, "sessionId"));
  }

  getExternalClaudeBackgroundStopCapability(
    sessionId: string
  ): Promise<ExternalClaudeBackgroundStopCapability> {
    return this.backend.getExternalClaudeBackgroundStopCapability(
      requireNonEmptyString(sessionId, "sessionId")
    );
  }

  stopExternalClaudeBackground(sessionId: string): Promise<SessionDetail> {
    return this.backend.stopExternalClaudeBackground(
      requireNonEmptyString(sessionId, "sessionId")
    );
  }

  getExternalDesktopInterruptCapability(
    sessionId: string
  ): Promise<ExternalDesktopInterruptCapability> {
    return this.backend.getExternalDesktopInterruptCapability(
      requireNonEmptyString(sessionId, "sessionId")
    );
  }

  interruptExternalDesktopSession(sessionId: string): Promise<SessionDetail> {
    return this.interrupts.interruptExternalDesktopSession(
      requireNonEmptyString(sessionId, "sessionId")
    );
  }

  openExternalCodexDesktopChat(sessionId: string): Promise<void> {
    return this.interrupts.openExternalCodexDesktopChat(
      requireNonEmptyString(sessionId, "sessionId")
    );
  }

  getExternalForceStopCapability(sessionId: string): Promise<ExternalForceStopCapability> {
    return this.backend.getExternalForceStopCapability(
      requireNonEmptyString(sessionId, "sessionId")
    );
  }

  forceStopExternalProcess(
    sessionId: string,
    target: ExternalForceStopTarget
  ): Promise<SessionDetail> {
    return this.interrupts.forceStopExternalProcess(
      requireNonEmptyString(sessionId, "sessionId"),
      target
    );
  }

  setPreviewPort(
    sessionId: string,
    port: number | null,
    networkMode?: PreviewNetworkMode
  ): Promise<SessionDetail> {
    return this.backend.setPreviewPort(
      requireNonEmptyString(sessionId, "sessionId"),
      validatePreviewPort(port),
      networkMode
    );
  }

  capturePreviewArtifact(
    sessionId: string,
    payload: CapturePreviewArtifactPayload
  ): Promise<SessionDetail> {
    return this.backend.capturePreviewArtifact(
      requireNonEmptyString(sessionId, "sessionId"),
      payload
    );
  }

  refreshSessionGit(
    sessionId: string,
    options?: ManagedSessionGitRefreshOptions
  ): Promise<SessionDetail> {
    return this.backend.refreshSessionGit(requireNonEmptyString(sessionId, "sessionId"), options);
  }

  syncReplyStatesForRunningAttachedSessions(): Promise<void> {
    return this.replyStateSync.syncOverview();
  }

  syncReplyStateForSession(sessionId: string): Promise<SessionDetail | null> {
    return this.replyStateSync.syncSession(requireNonEmptyString(sessionId, "sessionId"));
  }
}
