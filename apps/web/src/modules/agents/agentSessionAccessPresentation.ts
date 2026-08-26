import type { AgentSessionSummary } from "@deskcue/protocol";

function getSourceOwnerLabel(session: AgentSessionSummary) {
  if (session.agentId === "codex" && session.originator === "Codex Desktop") return "Codex Desktop";

  return null;
}

export function getUnavailableChatPresentation(session: AgentSessionSummary) {
  const sourceOwnerLabel = getSourceOwnerLabel(session);
  const sourceLocationLabel = sourceOwnerLabel ? `in ${sourceOwnerLabel}` : "outside DeskCue";
  const sourceControlLabel = sourceOwnerLabel ? `by ${sourceOwnerLabel}` : "outside DeskCue";

  if (session.workState === "running") {
    return {
      actionLabel: "Observe chat",
      capabilityLabel: `Active ${sourceLocationLabel}`,
      confirmLabel: "Open observation view",
      description:
        `DeskCue will open a live observation view. Messages and artifacts keep updating, ` +
        `but sending stays disabled while this turn is active ${sourceLocationLabel}.`,
      hint: `The current turn stays controlled ${sourceControlLabel}`,
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
