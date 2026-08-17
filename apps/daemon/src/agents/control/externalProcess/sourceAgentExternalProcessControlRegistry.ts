import { claudeCodeAdapter, codexAdapter } from "@deskcue/adapters";
import type { ExternalForceStopCapability, ExternalForceStopTarget } from "@deskcue/protocol";
import {
  getClaudeExternalForceStopCapability,
  requestClaudeExternalProcessForceStop
} from "#agents/claude/processControl/claudeExternalProcessControl";
import {
  getCodexExternalForceStopCapability,
  requestCodexExternalProcessForceStop
} from "#agents/codex/processControl/codexExternalProcessControl";
import type { ExternalProcessForceStopControlResult } from "#infrastructure/process/externalProcessControl";

export type SourceAgentExternalProcessControlDescriptor = {
  adapterId: string;
  agentLabel: string;
  getForceStopCapability: (sourceSessionId: string) => Promise<ExternalForceStopCapability>;
  requestForceStop: (
    sourceSessionId: string,
    target: ExternalForceStopTarget
  ) => Promise<ExternalProcessForceStopControlResult<string>>;
};

const sourceAgentExternalProcessControls = [
  {
    adapterId: codexAdapter.id,
    agentLabel: codexAdapter.label,
    getForceStopCapability: getCodexExternalForceStopCapability,
    requestForceStop: (sourceSessionId, target) => requestCodexExternalProcessForceStop(
      sourceSessionId,
      { expectedProcess: target }
    )
  },
  {
    adapterId: claudeCodeAdapter.id,
    agentLabel: claudeCodeAdapter.label,
    getForceStopCapability: getClaudeExternalForceStopCapability,
    requestForceStop: (sourceSessionId, target) => requestClaudeExternalProcessForceStop(
      sourceSessionId,
      { expectedProcess: target }
    )
  }
] satisfies readonly SourceAgentExternalProcessControlDescriptor[];

const sourceAgentExternalProcessControlByAdapterId = new Map(
  sourceAgentExternalProcessControls.map((descriptor) => [descriptor.adapterId, descriptor])
);

export function getSourceAgentExternalProcessControl(
  adapterId: string
): SourceAgentExternalProcessControlDescriptor | null {
  return sourceAgentExternalProcessControlByAdapterId.get(adapterId) ?? null;
}
