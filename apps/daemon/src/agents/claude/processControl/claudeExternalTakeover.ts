import { resolveClaudeBackgroundControlCapability } from "./claudeBackgroundControl.ts";
import type { ClaudeBackgroundControlCapability } from "./claudeBackgroundControl.ts";
import { getClaudeExternalForceStopCapability } from "./claudeExternalProcessControl.ts";
import type { ClaudeExternalForceStopCapability } from "./claudeExternalProcessControl.ts";

type ClaudeExternalTakeoverOptions = {
  getProcessCapability?: (sourceSessionId: string) => Promise<ClaudeExternalForceStopCapability>;
  getBackgroundControl?: (sourceSessionId: string) => Promise<ClaudeBackgroundControlCapability>;
};

/**
 * A force-stop may only hand a Claude chat to DeskCue after both independent
 * external controls agree that the source session is no longer active.
 */
export async function canTakeOverStoppedExternalClaudeSession(
  sourceSessionId: string,
  options: ClaudeExternalTakeoverOptions = {}
) {
  const [processCapability, backgroundControl] = await Promise.all([
    (options.getProcessCapability ?? getClaudeExternalForceStopCapability)(sourceSessionId),
    (options.getBackgroundControl ?? resolveClaudeBackgroundControlCapability)(sourceSessionId)
  ]);

  return (
    processCapability.kind === "unavailable" &&
    backgroundControl.kind === "observe_only" &&
    backgroundControl.reason === "session_not_listed"
  );
}
