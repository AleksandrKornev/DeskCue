import type { AgentSessionSummary, CodexSessionSummary } from "@deskcue/protocol";
import { AppError } from "#application/errors";

export function assertAgentSessionResumable(agentSession: AgentSessionSummary) {
  if (agentSession.attachMode === "resume") {
    return;
  }

  throw new AppError(
    "not_accepting_input",
    agentSession.attachModeReason ||
      `${agentSession.agentLabel} sessions are currently available for transcript review only.`
  );
}

export function buildFallbackCodexSessionSummary(
  agentSession: AgentSessionSummary
): CodexSessionSummary {
  if (!agentSession.workspacePath || !agentSession.workspaceName) {
    throw new AppError("invalid_input", "This agent session is missing workspace metadata.");
  }

  return {
    id: agentSession.sourceSessionId,
    threadName: agentSession.title,
    workspacePath: agentSession.workspacePath,
    workspaceName: agentSession.workspaceName,
    updatedAt: agentSession.updatedAt,
    model: agentSession.model,
    originator: agentSession.originator,
    cliVersion: agentSession.cliVersion,
    source: agentSession.source,
    filePath: agentSession.filePath,
    approvalPolicy: agentSession.approvalPolicy ?? null,
    sandboxMode: agentSession.sandboxMode ?? null
  };
}
