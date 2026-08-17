import {
  createExternalProcessForceStopControl,
  matchesExternalProcessTarget,
} from "#infrastructure/process/externalProcessControl";
import type {
  ExternalProcessForceStopCapability,
  ExternalProcessForceStopControlOptions,
  ExternalProcessForceStopControlResult,
  ExternalProcessTarget,
  ExternalProcessTerminator
} from "#infrastructure/process/externalProcessControl";
import type { ExternalProcessIdentity } from "#infrastructure/process/externalProcessIdentity";
import {
  windowsExternalProcessInventory
} from "#infrastructure/process/externalProcessInventory";

import {
  resolveCodexExternalProcessFromInventory,
  validateCodexExternalProcessFromInventory
} from "./codexExternalProcessResolver.ts";

type CodexExternalProcessUnavailableReason =
  | "no_exact_thread_process"
  | "ambiguous_exact_thread_process";

export type CodexExternalForceStopCapability =
  ExternalProcessForceStopCapability<CodexExternalProcessUnavailableReason>;

export type CodexExternalForceStopResult =
  ExternalProcessForceStopControlResult<CodexExternalProcessUnavailableReason>;

export type CodexExternalProcessTerminator = ExternalProcessTerminator;

export type CodexExternalProcessControlOptions = ExternalProcessForceStopControlOptions;

export type CodexExternalProcessTarget = ExternalProcessTarget;

const codexExternalProcessControl = createExternalProcessForceStopControl<CodexExternalProcessUnavailableReason>({
  inventory: windowsExternalProcessInventory,
  async resolve(sourceThreadId, inventory) {
    const resolution = await resolveCodexExternalProcessFromInventory(sourceThreadId, inventory);
    return resolution.confidence === "exact_thread_id_in_argv"
      ? { kind: "resolved", process: resolution.process }
      : { kind: "unavailable", reason: resolution.reason };
  },
  async validate(sourceThreadId, expected, inventory) {
    const validation = await validateCodexExternalProcessFromInventory(
      sourceThreadId,
      expected,
      inventory
    );
    return validation.confidence === "validated" ? validation.process : null;
  }
});

export async function getCodexExternalForceStopCapability(
  sourceThreadId: string,
  options: CodexExternalProcessControlOptions = {}
): Promise<CodexExternalForceStopCapability> {
  return codexExternalProcessControl.getCapability(sourceThreadId, options);
}

export function matchesCodexExternalProcessTarget(
  process: Pick<ExternalProcessIdentity, "processId" | "createdAt">,
  target: CodexExternalProcessTarget
) {
  return matchesExternalProcessTarget(process, target);
}

export async function requestCodexExternalProcessForceStop(
  sourceThreadId: string,
  options: CodexExternalProcessControlOptions = {}
): Promise<CodexExternalForceStopResult> {
  return codexExternalProcessControl.requestForceStop(sourceThreadId, options);
}
