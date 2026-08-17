import type {
  CloudConnectionStatusResponse,
  UpdateCloudPermissionsInput
} from "@deskcue/protocol";

export type PermissionDraft = UpdateCloudPermissionsInput;
export type PermissionPresetId = "full" | "metadata" | "review";

export interface PermissionPreset {
  description: string;
  id: PermissionPresetId;
  label: string;
  permissions: PermissionDraft;
  recommended?: boolean;
}

export const PERMISSION_PRESETS: readonly PermissionPreset[] = [
  {
    description: "Review sessions and files, send prompts, and open interactive Preview.",
    id: "full",
    label: "Full access",
    permissions: {
      allowRemoteControl: true,
      allowRemoteFiles: true,
      allowRemotePreview: true,
      allowRemoteRead: true
    },
    recommended: true
  },
  {
    description: "Review transcripts, diffs, and files without prompts, stop, or Preview.",
    id: "review",
    label: "Review only",
    permissions: {
      allowRemoteControl: false,
      allowRemoteFiles: true,
      allowRemotePreview: false,
      allowRemoteRead: true
    }
  },
  {
    description: "Share machine and session status only. No content or interactive access.",
    id: "metadata",
    label: "Metadata only",
    permissions: {
      allowRemoteControl: false,
      allowRemoteFiles: false,
      allowRemotePreview: false,
      allowRemoteRead: false
    }
  }
];

export const FULL_ACCESS_PERMISSIONS: PermissionDraft = {
  ...PERMISSION_PRESETS[0].permissions
};

export function arePermissionsEqual(
  left: PermissionDraft,
  right: PermissionDraft
): boolean {
  return left.allowRemoteRead === right.allowRemoteRead &&
    left.allowRemoteFiles === right.allowRemoteFiles &&
    left.allowRemoteControl === right.allowRemoteControl &&
    left.allowRemotePreview === right.allowRemotePreview;
}

export function getPermissionPreset(
  permissions: PermissionDraft
): PermissionPresetId | null {
  const preset = PERMISSION_PRESETS.find(({ permissions: candidate }) =>
    arePermissionsEqual(candidate, permissions)
  );

  return preset?.id ?? null;
}

export function permissionsFromStatus(
  status: CloudConnectionStatusResponse
): PermissionDraft {
  return {
    allowRemoteControl: status.remoteControlEnabled,
    allowRemoteFiles: status.remoteFilesEnabled,
    allowRemotePreview: status.remotePreviewEnabled,
    allowRemoteRead: status.remoteReadEnabled
  };
}

export function enabledCapabilityLabel(
  status: CloudConnectionStatusResponse
): string {
  const labels = [
    status.remoteReadEnabled ? "Session review" : null,
    status.remoteFilesEnabled ? "Workspace files" : null,
    status.remoteControlEnabled ? "Prompts and stop" : null,
    status.remotePreviewEnabled ? "Interactive Preview" : null
  ].filter((label): label is string => label !== null);

  return labels.length > 0 ? labels.join(" · ") : "Metadata only";
}
