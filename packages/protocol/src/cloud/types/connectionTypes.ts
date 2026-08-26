// Connector-facing status and enrollment contracts are grouped separately from relay frames.
export type CloudConnectorState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "degraded"
  | "revoked";

export type CloudConnectionStatusResponse = {
  connectorIncluded: true;
  connected: boolean;
  enabled: boolean;
  state: CloudConnectorState;
  cloudOrigin: string | null;
  displayName: string | null;
  machineId: string | null;
  lastConnectedAt: string | null;
  lastErrorCode: string | null;
  pendingEventCount: number;
  remoteReadEnabled: boolean;
  remoteFilesEnabled: boolean;
  remoteControlEnabled: boolean;
  remotePreviewEnabled: boolean;
  sessionLabelDisclosureEnabled: boolean;
};

export type UpdateCloudSessionDisclosureInput = {
  enabled: boolean;
};

export type UpdateCloudPermissionsInput = {
  allowRemoteRead: boolean;
  allowRemoteFiles: boolean;
  allowRemoteControl: boolean;
  allowRemotePreview: boolean;
};

export type ConnectCloudInput = {
  cloudOrigin: string;
  enrollmentTicket: string;
  displayName: string;
  allowRemoteRead: boolean;
  allowRemoteFiles: boolean;
  allowRemoteControl: boolean;
  allowRemotePreview: boolean;
};

export type StartCloudEnrollmentAttemptInput = Omit<
  ConnectCloudInput,
  "enrollmentTicket"
>;

export type CloudEnrollmentAttemptStatus =
  | "pending"
  | "failed"
  | "expired";

export type CloudEnrollmentAttempt = {
  attemptId: string;
  cloudOrigin: string;
  displayName: string;
  verificationUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
  status: CloudEnrollmentAttemptStatus;
  lastErrorCode: string | null;
};

export type CloudEnrollmentAttemptResponse = {
  attempt: CloudEnrollmentAttempt | null;
};
