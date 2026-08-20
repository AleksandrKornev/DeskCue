import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import { isActiveSourceTurn } from "@models/agentChatWorkState";

type PromptReplacementPreflightOptions = {
  actionDecisionProvided: boolean;
  adapterId: string | null;
  replacementRequested: boolean;
  sourceSessionId: string | null;
};

export async function resolveShouldReplaceRunningPrompt({
  actionDecisionProvided,
  adapterId,
  replacementRequested,
  sourceSessionId
}: PromptReplacementPreflightOptions) {
  if (replacementRequested) {
    return true;
  }
  if (actionDecisionProvided || !adapterId || !sourceSessionId) {
    return false;
  }

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
