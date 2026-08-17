import { getAdapterMetadata } from "@deskcue/adapters";
import type { SessionDetail, SessionSummary } from "@deskcue/protocol";

function getInputBlockedReason(session: SessionDetail) {
  if (session.adapterId === "claude-code" && session.command.endsWith(" (observe-only)")) {
    return "This Claude Code background chat can be observed or stopped, but Claude CLI cannot continue it in the same chat.";
  }

  if (session.status !== "running" && session.status !== "stopped") {
    return "This session is not accepting input.";
  }

  return "Prompt sending is not available for this session.";
}

export function withSessionInputCapability(
  session: SessionDetail,
  hasRunningChild: (sessionId: string) => boolean
): SessionDetail {
  const isObserveOnlyClaudeSession =
    session.adapterId === "claude-code" && session.command.endsWith(" (observe-only)");
  const canResumeAdapterSession =
    getAdapterMetadata(session.adapterId)?.capabilities.resume === true &&
    Boolean(session.sourceSessionId) &&
    (session.status === "read_only" || session.status === "stopped");
  const canRestartCompletedClaudeShell =
    session.adapterId === "claude-code" &&
    Boolean(session.sourceSessionId) &&
    session.status === "done";
  const canRestartDetachedCodexShell =
    session.adapterId === "codex" &&
    Boolean(session.sourceSessionId) &&
    session.status === "running";
  const canSendInput =
    !isObserveOnlyClaudeSession && (
      hasRunningChild(session.id) ||
      canResumeAdapterSession ||
      canRestartCompletedClaudeShell ||
      canRestartDetachedCodexShell
    );

  return {
    ...session,
    canSendInput,
    inputBlockedReason: canSendInput ? null : getInputBlockedReason(session)
  };
}

export function toSessionSummary(
  session: SessionDetail,
  hasRunningChild: (sessionId: string) => boolean
): SessionSummary {
  const sessionWithInputCapability = withSessionInputCapability(session, hasRunningChild);

  return {
    id: sessionWithInputCapability.id,
    workspaceId: sessionWithInputCapability.workspaceId,
    workspaceName: sessionWithInputCapability.workspaceName,
    adapterId: sessionWithInputCapability.adapterId,
    sourceSessionId: sessionWithInputCapability.sourceSessionId,
    sourceSessionFilePath: sessionWithInputCapability.sourceSessionFilePath ?? null,
    command: sessionWithInputCapability.command,
    status: sessionWithInputCapability.status,
    startedAt: sessionWithInputCapability.startedAt,
    finishedAt: sessionWithInputCapability.finishedAt,
    lastActivityAt: sessionWithInputCapability.lastActivityAt,
    exitCode: sessionWithInputCapability.exitCode,
    preview: sessionWithInputCapability.preview,
    replyState: sessionWithInputCapability.replyState,
    promptRecovery: sessionWithInputCapability.promptRecovery ?? null,
    actionRequest: sessionWithInputCapability.actionRequest,
    canSendInput: sessionWithInputCapability.canSendInput,
    inputBlockedReason: sessionWithInputCapability.inputBlockedReason,
    git: {
      ...sessionWithInputCapability.git,
      diff: ""
    }
  };
}
