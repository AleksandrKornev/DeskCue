import {
  createExternalProcessForceStopControl,
  matchesExternalProcessTarget,
} from "#infrastructure/process/externalProcessControl";
import type {
  ExternalProcessForceStopCapability,
  ExternalProcessForceStopControlOptions,
  ExternalProcessForceStopControlResult,
  ExternalProcessTarget,
} from "#infrastructure/process/externalProcessControl";
import type { ExternalProcessIdentity } from "#infrastructure/process/externalProcessIdentity";
import { windowsExternalProcessInventory } from "#infrastructure/process/externalProcessInventory";

import {
  resolveClaudeExternalProcess,
  validateClaudeExternalProcess
} from "./claudeExternalProcessResolver.ts";

type ClaudeExternalProcessUnavailableReason =
  | "no_exact_session_process"
  | "ambiguous_exact_session_process";

export type ClaudeExternalProcessTarget = ExternalProcessTarget;

export type ClaudeExternalForceStopCapability =
  ExternalProcessForceStopCapability<ClaudeExternalProcessUnavailableReason>;

export type ClaudeExternalForceStopResult =
  ExternalProcessForceStopControlResult<ClaudeExternalProcessUnavailableReason>;

export type ClaudeExternalProcessControlOptions = ExternalProcessForceStopControlOptions;

const claudeExternalProcessControl = createExternalProcessForceStopControl<ClaudeExternalProcessUnavailableReason>({
  inventory: windowsExternalProcessInventory,
  async resolve(sourceSessionId, inventory) {
    const resolution = resolveClaudeExternalProcess(
      sourceSessionId,
      await inventory.listProcesses()
    );
    return resolution.confidence === "exact_session_id_in_argv"
      ? { kind: "resolved", process: resolution.process }
      : { kind: "unavailable", reason: resolution.reason };
  },
  async validate(sourceSessionId, expected, inventory) {
    const validation = validateClaudeExternalProcess(
      sourceSessionId,
      expected,
      await inventory.listProcesses()
    );
    return validation.confidence === "validated" ? validation.process : null;
  }
});

export async function getClaudeExternalForceStopCapability(
  sourceSessionId: string,
  options: ClaudeExternalProcessControlOptions = {}
): Promise<ClaudeExternalForceStopCapability> {
  return claudeExternalProcessControl.getCapability(sourceSessionId, options);
}

export function matchesClaudeExternalProcessTarget(
  process: Pick<ExternalProcessIdentity, "processId" | "createdAt">,
  target: ClaudeExternalProcessTarget
) {
  return matchesExternalProcessTarget(process, target);
}

export async function requestClaudeExternalProcessForceStop(
  sourceSessionId: string,
  options: ClaudeExternalProcessControlOptions = {}
): Promise<ClaudeExternalForceStopResult> {
  return claudeExternalProcessControl.requestForceStop(sourceSessionId, options);
}
