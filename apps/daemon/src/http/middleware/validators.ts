import {
  ProtocolSchemaError,
  parseExternalForceStopPayload,
  parseCapturePreviewArtifactPayload,
  parseCreateSessionInput,
  parseCreateWorkspaceInput,
  parseResumeAgentSessionInput,
  parseResumeCodexSessionInput,
  parseRunManualCommandInput,
  parseSendInputPayload,
  parseSetPreviewPortPayload,
  parseUpdateDaemonSettingsInput
} from "@deskcue/protocol";
import type {
  CapturePreviewArtifactPayload,
  CreateSessionInput,
  ExternalForceStopPayload,
  CreateWorkspaceInput,
  RunManualCommandInput,
  ResumeAgentSessionInput,
  ResumeCodexSessionInput,
  SendInputPayload,
  SetPreviewPortPayload,
  UpdateDaemonSettingsInput
} from "@deskcue/protocol";
import { AppError } from "#application/errors";

export function readProtocolPayload<T>(parse: () => T) {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ProtocolSchemaError) {
      throw new AppError("invalid_input", error.message);
    }

    throw error;
  }
}

export function readCreateWorkspaceInput(value: unknown): CreateWorkspaceInput {
  return readProtocolPayload(() => parseCreateWorkspaceInput(value));
}

export function readCreateSessionInput(value: unknown): CreateSessionInput {
  return readProtocolPayload(() => parseCreateSessionInput(value));
}

export function readRunManualCommandInput(value: unknown): RunManualCommandInput {
  return readProtocolPayload(() => parseRunManualCommandInput(value));
}

export function readSendInputPayload(value: unknown): SendInputPayload {
  return readProtocolPayload(() => parseSendInputPayload(value));
}

export function readExternalForceStopPayload(value: unknown): ExternalForceStopPayload {
  return readProtocolPayload(() => parseExternalForceStopPayload(value));
}

export function readSetPreviewPortPayload(value: unknown): SetPreviewPortPayload {
  return readProtocolPayload(() => parseSetPreviewPortPayload(value));
}

export function readCapturePreviewArtifactPayload(value: unknown): CapturePreviewArtifactPayload {
  return readProtocolPayload(() => parseCapturePreviewArtifactPayload(value));
}

export function readResumeAgentSessionInput(value: unknown): ResumeAgentSessionInput {
  return readProtocolPayload(() => parseResumeAgentSessionInput(value));
}

export function readResumeCodexSessionInput(value: unknown): ResumeCodexSessionInput {
  return readProtocolPayload(() => parseResumeCodexSessionInput(value));
}

export function readUpdateDaemonSettingsInput(value: unknown): UpdateDaemonSettingsInput {
  return readProtocolPayload(() => parseUpdateDaemonSettingsInput(value));
}
