import { codexAdapter, getAdapterMetadata } from "@deskcue/adapters";
import type { AgentSessionSummary, SessionDetail, WorkspaceSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";
import { logger } from "#infrastructure/logging/logger";
import {
  isApprovalDecisionInput,
  toApprovalDecisionKey
} from "#sessions/actionRequest/sessionActionRequest";
import {
  forwardSessionActionDecision,
  forwardSessionInput
} from "#sessions/process/sessionProcess";
import type { RunningChild } from "#sessions/process/sessionProcess";

type SessionPromptDeliveryCallbacks = {
  appendSystemLog: (sessionId: string, text: string) => void;
  getChild: (sessionId: string) => RunningChild | undefined;
  getPublicSession: (sessionId: string) => SessionDetail | null;
  getSession: (sessionId: string) => SessionDetail | null;
  getWorkspace: (workspaceId: string) => WorkspaceSummary | null;
  persistState: () => Promise<void>;
  resumeAgentSession: (
    agentSession: AgentSessionSummary,
    prompt?: string
  ) => Promise<SessionDetail>;
  sendSourceInput: (
    session: SessionDetail,
    child: RunningChild | undefined,
    input: string
  ) => Promise<SessionDetail>;
  supportsSourceInput: (adapterId: string) => boolean;
  updateSession: (sessionId: string, patch: Partial<SessionDetail>) => void;
};

type ManagedPromptDeliveryLifecycle = {
  markAccepted: () => void;
  markDispatching: () => boolean;
  markOutcomeUnknown: () => void;
};

async function sendActionDecision(
  callbacks: SessionPromptDeliveryCallbacks,
  session: SessionDetail,
  child: RunningChild,
  input: string
) {
  const decisionKey = toApprovalDecisionKey(input);
  const decisionLabel = decisionKey === "\x1b" ? "rejected" : "approved";

  forwardSessionActionDecision(child, decisionKey);
  callbacks.updateSession(session.id, {
    actionRequest: null,
    inputHistory: [...session.inputHistory, decisionKey === "\x1b" ? "reject" : "approve"]
  });
  logger.info("Session action decision forwarded", {
    decision: decisionLabel,
    sessionId: session.id
  });
  callbacks.appendSystemLog(session.id, `Approval ${decisionLabel} from DeskCue.\n`);
  await callbacks.persistState();

  const updatedSession = callbacks.getPublicSession(session.id);
  if (!updatedSession) throw new AppError("not_found", "Session not found.");

  return updatedSession;
}

function toAgentKind(adapterId: string): AgentSessionSummary["agentId"] {
  if (adapterId === codexAdapter.id) return "codex";

  if (adapterId === "claude-code") return "claude-code";

  return "other";
}

function buildDetachedAgentSessionSummary(
  session: SessionDetail,
  workspace: WorkspaceSummary
): AgentSessionSummary {
  return {
    id: `${session.adapterId}:${session.sourceSessionId}`,
    agentId: toAgentKind(session.adapterId),
    agentLabel: getAdapterMetadata(session.adapterId)?.label ?? session.adapterId,
    sourceSessionId: session.sourceSessionId ?? "",
    title: session.workspaceName,
    workspacePath: workspace.path,
    workspaceName: workspace.name,
    updatedAt: session.lastActivityAt,
    model: null,
    originator: null,
    cliVersion: null,
    source: null,
    filePath: "",
    approvalPolicy: null,
    sandboxMode: null,
    attachMode: "resume",
    attachModeReason: null,
    workState: "idle"
  };
}

async function resumeDetachedAgentSession(
  callbacks: SessionPromptDeliveryCallbacks,
  session: SessionDetail,
  input: string
) {
  const prompt = input.trim();
  if (!prompt) throw new AppError("invalid_input", "Prompt is empty.");

  if (!session.sourceSessionId) throw new AppError("not_accepting_input", "Session is not accepting input.");

  const workspace = callbacks.getWorkspace(session.workspaceId);
  if (!workspace) throw new AppError("not_found", "Workspace not found.");

  return callbacks.resumeAgentSession(buildDetachedAgentSessionSummary(session, workspace), prompt);
}

function canResumeDetachedSession(session: SessionDetail) {
  return getAdapterMetadata(session.adapterId)?.capabilities.resume === true;
}

export async function sendSessionInput(
  callbacks: SessionPromptDeliveryCallbacks,
  sessionId: string,
  input: string,
  managedPromptDelivery?: ManagedPromptDeliveryLifecycle
) {
  const session = callbacks.getSession(sessionId);
  const child = callbacks.getChild(sessionId);

  if (!session) throw new AppError("not_accepting_input", "Session is not accepting input.");

  if (child && session.actionRequest?.kind === "approval" && isApprovalDecisionInput(input)) {
    return await sendActionDecision(callbacks, session, child, input);
  }

  if (session.sourceSessionId && callbacks.supportsSourceInput(session.adapterId)) {
    return callbacks.sendSourceInput(session, child, input);
  }

  if (
    !child &&
    session.sourceSessionId &&
    canResumeDetachedSession(session) &&
    (session.status === "read_only" || session.status === "stopped")
  ) {
    return resumeDetachedAgentSession(callbacks, session, input);
  }

  if (!child) throw new AppError("not_accepting_input", "Session is not accepting input.");

  if (managedPromptDelivery && !managedPromptDelivery.markDispatching()) {
    throw new AppError(
      "not_accepting_input",
      "Prompt delivery could not enter the dispatching state."
    );
  }
  try {
    forwardSessionInput(session, child, input);
    managedPromptDelivery?.markAccepted();
  } catch (error) {
    managedPromptDelivery?.markOutcomeUnknown();
    throw error;
  }
  callbacks.updateSession(sessionId, {
    inputHistory: [...session.inputHistory, input]
  });
  logger.info("Session input forwarded", {
    sessionId,
    inputLength: input.length
  });
  callbacks.appendSystemLog(sessionId, "Input sent.\n");
  await callbacks.persistState();

  const updatedSession = callbacks.getPublicSession(sessionId);
  if (!updatedSession) throw new AppError("not_found", "Session not found.");

  return updatedSession;
}
