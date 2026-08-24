import type {
  CloudConnectorState,
  CloudEnrollmentAttempt
} from "@deskcue/protocol";

import type { PermissionDraft } from "./permissions";

export const OFFICIAL_CLOUD_ORIGIN = import.meta.env.VITE_DESKCUE_CLOUD_ORIGIN ?? "https://app.deskcue.io";
export const ENROLLMENT_STATUS_REFRESH_MS = 2_000;

export type PermissionFeedback = {
  kind: "error" | "success";
  message: string;
};

export type PermissionOption = {
  description: string;
  key: keyof PermissionDraft;
  label: string;
};

export const PERMISSION_OPTIONS: readonly PermissionOption[] = [
  {
    description: "Allows this Cloud to request bounded transcripts and diffs while the daemon is connected. You can leave this off for metadata-only monitoring.",
    key: "allowRemoteRead",
    label: "Enable Remote DeskCue session review"
  },
  {
    description: "Allows this Cloud to open the configured local Preview through an isolated, short-lived origin. Arbitrary local hosts and ports remain blocked.",
    key: "allowRemotePreview",
    label: "Allow remote app Preview"
  },
  {
    description: "Allows this Cloud to request bounded directory listings and text previews from registered workspaces. File paths and contents pass through transiently and are not persisted by DeskCue Cloud.",
    key: "allowRemoteFiles",
    label: "Allow remote workspace file browsing"
  },
  {
    description: "Allows this Cloud to send prompts and request a stop for supported agent turns. Prompt content passes through the Cloud service transiently and is not persisted there.",
    key: "allowRemoteControl",
    label: "Allow remote prompts and stop requests"
  }
];

export function connectionHeading(connected: boolean, hasCloudProfile: boolean) {
  if (connected) return "Connected to DeskCue Cloud";
  if (hasCloudProfile) return "Reconnecting to DeskCue Cloud";

  return "Cloud connector available";
}

export function connectionDescription({
  connected,
  enrollmentAttempt,
  hasCloudProfile,
  pendingEventCount
}: {
  connected: boolean;
  enrollmentAttempt: CloudEnrollmentAttempt | null;
  hasCloudProfile: boolean;
  pendingEventCount: number;
}) {
  if (connected) return `Outbound relay active${pendingEventCount ? ` · ${pendingEventCount} pending` : ""}.`;
  if (hasCloudProfile) return "Your saved permissions remain active while the outbound relay reconnects.";
  if (enrollmentAttempt) return "Finish signing in and approve this machine in DeskCue Cloud.";

  return "Open DeskCue Cloud, sign in, and approve this machine.";
}

export function cloudStatusLabel(
  connected: boolean,
  state: CloudConnectorState | undefined
) {
  if (connected) return "Cloud connected";
  if (state === "connecting") return "Connecting";
  if (state === "degraded") return "Cloud degraded";
  if (state === "revoked") return "Cloud access revoked";

  return "Local only";
}
