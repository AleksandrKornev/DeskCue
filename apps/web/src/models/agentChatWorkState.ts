import type {
  AgentSessionDetail,
  AgentSessionSummary,
  SessionSummary
} from "@deskcue/protocol";
import type { PendingChatPrompt } from "@models/promptDelivery";

export type AgentChatWorkIndicator = {
  label: string;
  tone: "active" | "waiting" | "readonly";
  viewerCount: number;
  sessionId: string;
};

export function getSourceSessionKey(adapterId: string, sourceSessionId: string | null) {
  return sourceSessionId ? `${adapterId}:${sourceSessionId}` : null;
}

export function isManagedSessionActivelyAttached(session: SessionSummary) {
  return Boolean(session.sourceSessionId) && session.status === "running";
}

export function isManagedSessionRunningWork(session: SessionSummary) {
  const hasActiveReply =
    session.replyState.phase === "sending" ||
    session.replyState.phase === "waiting";

  return (
    Boolean(session.actionRequest) ||
    hasActiveReply ||
    (session.status === "running" && !session.sourceSessionId)
  );
}

export function isAgentSessionRunningWork(session: AgentSessionSummary) {
  return session.workState === "running";
}

export function isActiveSourceTurn(
  session: Pick<AgentSessionDetail, "turnState" | "workState"> | null | undefined
) {
  if (!session) {
    return false;
  }

  return session.turnState
    ? session.turnState.phase === "active"
    : session.workState === "running";
}

export function countRunningAgentChats({
  agentSessions,
  managedSessions
}: {
  agentSessions: AgentSessionSummary[];
  managedSessions: SessionSummary[];
}) {
  const runningSourceSessionKeys = new Set<string>();
  let runningCount = 0;

  for (const session of managedSessions) {
    if (!isManagedSessionRunningWork(session)) {
      continue;
    }

    const sourceSessionKey = getSourceSessionKey(session.adapterId, session.sourceSessionId);
    if (sourceSessionKey) {
      if (runningSourceSessionKeys.has(sourceSessionKey)) {
        continue;
      }
      runningSourceSessionKeys.add(sourceSessionKey);
    }

    runningCount += 1;
  }

  for (const session of agentSessions) {
    if (!isAgentSessionRunningWork(session)) {
      continue;
    }

    const sourceSessionKey = getSourceSessionKey(session.agentId, session.sourceSessionId);
    if (sourceSessionKey && runningSourceSessionKeys.has(sourceSessionKey)) {
      continue;
    }

    if (sourceSessionKey) {
      runningSourceSessionKeys.add(sourceSessionKey);
    }
    runningCount += 1;
  }

  return runningCount;
}

export function buildManagedChatWorkIndicator(
  session: SessionSummary
): AgentChatWorkIndicator | null {
  const viewerCount = session.viewerCount ?? 0;

  if (session.actionRequest) {
    return {
      label: "Approval",
      tone: "waiting",
      viewerCount,
      sessionId: session.id
    };
  }

  if (session.replyState.phase === "sending") {
    return {
      label: "Sending",
      tone: "waiting",
      viewerCount,
      sessionId: session.id
    };
  }

  if (session.replyState.phase === "waiting") {
    return {
      label: "Waiting",
      tone: "waiting",
      viewerCount,
      sessionId: session.id
    };
  }

  if (session.status === "running" && !session.sourceSessionId) {
    return {
      label: "Running",
      tone: "active",
      viewerCount,
      sessionId: session.id
    };
  }

  return null;
}

export function buildAgentChatWorkIndicator(
  session: AgentSessionSummary
): AgentChatWorkIndicator | null {
  if (!isAgentSessionRunningWork(session)) {
    return null;
  }

  return {
    label: "Running",
    tone: "active",
    viewerCount: 0,
    sessionId: session.id
  };
}

export function buildPendingPromptChatWorkIndicator(
  prompt: PendingChatPrompt | null
): AgentChatWorkIndicator | null {
  if (!prompt?.sourceSessionId || prompt.status === "cancelled") {
    return null;
  }

  return {
    label: "Waiting",
    tone: "waiting",
    viewerCount: 0,
    sessionId: prompt.sessionId ?? prompt.sourceSessionId
  };
}

export function getWorkIndicatorPriority(indicator: AgentChatWorkIndicator) {
  if (indicator.tone === "waiting") {
    return 4;
  }

  if (indicator.tone === "active") {
    return 3;
  }

  return 1;
}
