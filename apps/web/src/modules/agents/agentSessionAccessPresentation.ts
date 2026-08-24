import type { AgentSessionSummary } from "@deskcue/protocol";

function getSourceOwnerLabel(session: AgentSessionSummary) {
  return session.agentId === "codex" ? "Codex Desktop" : session.agentLabel;
}

export function getUnavailableChatPresentation(session: AgentSessionSummary) {
  const sourceOwnerLabel = getSourceOwnerLabel(session);

  if (session.workState === "running") {
    return {
      actionLabel: "Observe chat",
      capabilityLabel: `Active in ${sourceOwnerLabel}`,
      confirmLabel: "Open observation view",
      description:
        `DeskCue will open a live observation view. Messages and artifacts keep updating, ` +
        `but sending stays disabled while this turn is active in ${sourceOwnerLabel}.`,
      hint: `The current turn stays controlled by ${sourceOwnerLabel}`,
      title: "Open observation view?"
    };
  }

  return {
    actionLabel: "Open view-only chat",
    capabilityLabel: "View only",
    confirmLabel: "Open view-only chat",
    description:
      "DeskCue will open the transcript and artifacts in a managed view. Sending is unavailable for this chat.",
    hint: "Review the transcript and artifacts; this chat cannot be continued from DeskCue",
    title: "Open view-only chat?"
  };
}
