import type { AgentSessionSummary } from "@deskcue/protocol";
import { isSubagentChat } from "@components/AgentChatBadge/isSubagentChat";

export const INITIAL_VISIBLE_SESSIONS = 8;
export const VISIBLE_SESSIONS_INCREMENT = 24;
export const AGENT_SESSIONS_COMPACT_MEDIA_QUERY = "(max-width: 1120px)";
export const AGENT_SESSIONS_MOBILE_MEDIA_QUERY = "(max-width: 720px)";
export const SOURCE_SWITCH_MIN_PLACEHOLDER_MS = 400;

export function filterAndSortAgentSessionsByQuery(
  agentSessions: AgentSessionSummary[],
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase();
  const listSessions = normalizedQuery
    ? agentSessions
    : agentSessions.filter((session) => !isSubagentChat(session));
  const matchingSessions = normalizedQuery
    ? listSessions.filter((session) =>
        [
          session.id,
          session.sourceSessionId,
          session.title,
          session.workspaceName ?? "",
          session.workspacePath ?? "",
          session.agentLabel,
          session.model ?? "",
          session.source ?? "",
          session.filePath,
          session.approvalPolicy ?? "",
          session.sandboxMode ?? "",
          session.subagent?.nickname ?? "",
          session.subagent?.role ?? ""
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      )
    : listSessions;

  return [...matchingSessions].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
