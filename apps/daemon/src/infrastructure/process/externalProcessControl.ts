import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ExternalProcessIdentity } from "./externalProcessIdentity.ts";
import type { ExternalProcessInventory } from "./externalProcessInventory.ts";

export type ExternalProcessTarget = {
  processId: number;
  processCreatedAt: string;
};

export type ExternalProcessTerminator = (processId: number) => Promise<void>;

export type ExternalProcessForceStopCapability<UnavailableReason extends string> =
  | ({ kind: "available" } & ExternalProcessTarget)
  | {
      kind: "unavailable";
      reason: "platform_unsupported" | UnavailableReason;
    };

export type ExternalProcessForceStopResult<UnavailableReason extends string> =
  | { kind: "stop_requested"; processId: number }
  | { kind: "control_unavailable"; reason: UnavailableReason }
  | { kind: "process_identity_changed" }
  | { kind: "stop_failed"; processId: number };

type ProcessResolution<UnavailableReason extends string> =
  | { kind: "resolved"; process: ExternalProcessIdentity }
  | { kind: "unavailable"; reason: UnavailableReason };

type RequestExternalProcessForceStopOptions<UnavailableReason extends string> = {
  expectedProcess?: ExternalProcessTarget;
  inventory: ExternalProcessInventory;
  resolve: (
    inventory: ExternalProcessInventory
  ) => Promise<ProcessResolution<UnavailableReason>>;
  validate: (
    process: ExternalProcessIdentity,
    inventory: ExternalProcessInventory
  ) => Promise<ExternalProcessIdentity | null>;
  terminateProcessTree?: ExternalProcessTerminator;
};

export type ExternalProcessForceStopControlOptions = {
  expectedProcess?: ExternalProcessTarget;
  inventory?: ExternalProcessInventory;
  terminateProcessTree?: ExternalProcessTerminator;
};

type ExternalProcessForceStopControlStrategy<UnavailableReason extends string> = {
  inventory: ExternalProcessInventory;
  resolve: (
    sourceSessionId: string,
    inventory: ExternalProcessInventory
  ) => Promise<ProcessResolution<UnavailableReason>>;
  validate: (
    sourceSessionId: string,
    process: ExternalProcessIdentity,
    inventory: ExternalProcessInventory
  ) => Promise<ExternalProcessIdentity | null>;
};

export type ExternalProcessForceStopControl<UnavailableReason extends string> = {
  getCapability: (
    sourceSessionId: string,
    options?: ExternalProcessForceStopControlOptions
  ) => Promise<ExternalProcessForceStopCapability<UnavailableReason>>;
  requestForceStop: (
    sourceSessionId: string,
    options?: ExternalProcessForceStopControlOptions
  ) => Promise<ExternalProcessForceStopControlResult<UnavailableReason>>;
};

export type ExternalProcessForceStopControlResult<UnavailableReason extends string> =
  | { kind: "stop_requested"; processId: number }
  | {
      kind: "control_unavailable";
      capability: ExternalProcessForceStopCapability<UnavailableReason>;
    }
  | { kind: "process_identity_changed" }
  | { kind: "stop_failed"; processId: number };

const execFileAsync = promisify(execFile);

function unavailableCapability<UnavailableReason extends string>(
  reason: "platform_unsupported" | UnavailableReason
): ExternalProcessForceStopCapability<UnavailableReason> {
  return { kind: "unavailable", reason };
}

export function matchesExternalProcessTarget(
  process: Pick<ExternalProcessIdentity, "processId" | "createdAt">,
  target: ExternalProcessTarget
) {
  return process.processId === target.processId && process.createdAt === target.processCreatedAt;
}

export async function terminateWindowsExternalProcessTree(processId: number) {
  if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error("Invalid process id.");

  await execFileAsync("taskkill.exe", ["/pid", String(processId), "/t", "/f"], {
    windowsHide: true,
    shell: false
  });
}

export async function requestExternalProcessForceStop<UnavailableReason extends string>(
  options: RequestExternalProcessForceStopOptions<UnavailableReason>
): Promise<ExternalProcessForceStopResult<UnavailableReason>> {
  const resolution = await options.resolve(options.inventory);
  if (resolution.kind === "unavailable") return { kind: "control_unavailable", reason: resolution.reason };
  if (
    options.expectedProcess &&
    !matchesExternalProcessTarget(resolution.process, options.expectedProcess)
  ) {
    return { kind: "process_identity_changed" };
  }

  const validated = await options.validate(resolution.process, options.inventory);
  if (!validated) return { kind: "process_identity_changed" };

  try {
    await (options.terminateProcessTree ?? terminateWindowsExternalProcessTree)(validated.processId);
    return { kind: "stop_requested", processId: validated.processId };
  } catch {
    return { kind: "stop_failed", processId: validated.processId };
  }
}

export function createExternalProcessForceStopControl<UnavailableReason extends string>(
  strategy: ExternalProcessForceStopControlStrategy<UnavailableReason>
): ExternalProcessForceStopControl<UnavailableReason> {
  async function getCapability(
    sourceSessionId: string,
    options: ExternalProcessForceStopControlOptions = {}
  ): Promise<ExternalProcessForceStopCapability<UnavailableReason>> {
    if (process.platform !== "win32") return unavailableCapability("platform_unsupported");

    const resolution = await strategy.resolve(
      sourceSessionId,
      options.inventory ?? strategy.inventory
    );
    if (resolution.kind === "unavailable") return unavailableCapability(resolution.reason);

    return {
      kind: "available",
      processId: resolution.process.processId,
      processCreatedAt: resolution.process.createdAt
    };
  }

  async function requestForceStop(
    sourceSessionId: string,
    options: ExternalProcessForceStopControlOptions = {}
  ): Promise<ExternalProcessForceStopControlResult<UnavailableReason>> {
    if (process.platform !== "win32") {
      return {
        kind: "control_unavailable",
        capability: unavailableCapability("platform_unsupported")
      };
    }

    const result = await requestExternalProcessForceStop({
      expectedProcess: options.expectedProcess,
      inventory: options.inventory ?? strategy.inventory,
      resolve: (inventory) => strategy.resolve(sourceSessionId, inventory),
      validate: (expected, inventory) => strategy.validate(sourceSessionId, expected, inventory),
      terminateProcessTree: options.terminateProcessTree
    });

    return result.kind === "control_unavailable"
      ? { kind: "control_unavailable", capability: unavailableCapability(result.reason) }
      : result;
  }

  return { getCapability, requestForceStop };
}
