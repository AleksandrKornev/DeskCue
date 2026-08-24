import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import { isActiveSourceTurn } from "@models/agentChatWorkState";

type PromptReplacementPreflightOptions = {
  actionDecisionProvided: boolean;
  adapterId: string | null;
  managedSessionStatus: string | null;
  replacementRequested: boolean;
  sourceSessionId: string | null;
};

export async function resolveShouldReplaceRunningPrompt({
  actionDecisionProvided,
  adapterId,
  managedSessionStatus,
  replacementRequested,
  sourceSessionId
}: PromptReplacementPreflightOptions) {
  if (replacementRequested) return true;

  if (managedSessionStatus === "done" || managedSessionStatus === "stopped") {
    // A terminal managed transport is authoritative even when Codex discovery
    // has not yet observed the killed one-shot process. Resume it directly;
    // interrupting the stale source view can only return a false 409.
    return false;
  }

  if (actionDecisionProvided || !adapterId || !sourceSessionId) return false;

  try {
    const sourceSession = await agentSessionsApi.getOne(
      `${adapterId}:${sourceSessionId}`,
      { omitTranscript: true }
    );

    return isActiveSourceTurn(sourceSession);
  } catch {
    // Live metadata is advisory. The managed input path still reports a
    // transport conflict if the source changes after this preflight.
    return false;
  }
}
