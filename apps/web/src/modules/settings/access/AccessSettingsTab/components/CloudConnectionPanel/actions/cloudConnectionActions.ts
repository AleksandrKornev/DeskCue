import type {
  Dispatch,
  FormEvent,
  SetStateAction,
  SyntheticEvent
} from "react";

import type { CloudEnrollmentAttempt } from "@deskcue/protocol";
import { cloudApi } from "@api/endpoint/cloud/endpoints";
import { useCloudConnectionStatus } from "@modules/cloudConnection/model/useCloudConnectionStatus";
import { OFFICIAL_CLOUD_ORIGIN } from "@modules/settings/access/AccessSettingsTab/components/CloudConnectionPanel/cloudConnectionPresentation";
import type { PermissionFeedback } from "@modules/settings/access/AccessSettingsTab/components/CloudConnectionPanel/cloudConnectionPresentation";
import { usePermissionDraft } from "@modules/settings/access/AccessSettingsTab/components/CloudConnectionPanel/usePermissionDraft";

type CloudConnectionStatusModel = ReturnType<typeof useCloudConnectionStatus>;
type PermissionDraftModel = ReturnType<typeof usePermissionDraft>;

export type CloudConnectionActionContext = {
  cloudOrigin: string;
  displayName: string;
  enrollmentTicket: string;
  permissionDraft: PermissionDraftModel;
  refresh: CloudConnectionStatusModel["refresh"];
  setActionError: Dispatch<SetStateAction<string | null>>;
  setEnrollmentAttempt: Dispatch<SetStateAction<CloudEnrollmentAttempt | null>>;
  setEnrollmentTicket: Dispatch<SetStateAction<string>>;
  setPermissionsFeedback: Dispatch<SetStateAction<PermissionFeedback | null>>;
  setPermissionsSubmitting: Dispatch<SetStateAction<boolean>>;
  setStatus: CloudConnectionStatusModel["setStatus"];
  setSubmitting: Dispatch<SetStateAction<boolean>>;
};

export async function refreshEnrollmentAttempt(
  activeRef: { current: boolean },
  context: Pick<CloudConnectionActionContext, "refresh" | "setEnrollmentAttempt">
) {
  try {
    const response = await cloudApi.getEnrollmentAttempt();

    if (!activeRef.current) return;

    context.setEnrollmentAttempt(response.attempt);
    if (!response.attempt) await context.refresh();
  } catch {
    // The main connection status already surfaces daemon reachability errors.
  }
}

export async function startEnrollmentAttempt(
  event: FormEvent,
  context: CloudConnectionActionContext
) {
  event.preventDefault();
  context.setSubmitting(true);
  context.setActionError(null);
  const verificationWindow = window.open("about:blank", "_blank");

  if (verificationWindow) verificationWindow.opener = null;
  const result = await cloudApi.startEnrollmentAttempt({
    ...context.permissionDraft.permissions,
    cloudOrigin: OFFICIAL_CLOUD_ORIGIN,
    displayName: context.displayName
  });

  if (result.ok && result.data.attempt) {
    context.setEnrollmentAttempt(result.data.attempt);
    if (verificationWindow) {
      verificationWindow.location.href = result.data.attempt.verificationUrl;
    } else {
      window.location.assign(result.data.attempt.verificationUrl);
    }
  } else {
    verificationWindow?.close();
    context.setActionError(result.ok
      ? "DeskCue Cloud did not return an enrollment attempt"
      : result.data.error ?? "Failed to start DeskCue Cloud enrollment");
  }

  context.setSubmitting(false);
}

export async function submitConnection(
  event: SyntheticEvent,
  context: CloudConnectionActionContext
) {
  event.preventDefault();
  context.setSubmitting(true);
  context.setActionError(null);
  const result = await cloudApi.connect({
    ...context.permissionDraft.permissions,
    cloudOrigin: context.cloudOrigin,
    displayName: context.displayName,
    enrollmentTicket: context.enrollmentTicket
  });

  if (result.ok) {
    context.setStatus(result.data);
    context.setEnrollmentTicket("");
    await context.refresh();
  } else {
    context.setActionError(result.data.error ?? "Failed to connect to DeskCue Cloud");
  }

  context.setSubmitting(false);
}

export async function disconnect(context: CloudConnectionActionContext) {
  context.setSubmitting(true);
  context.setActionError(null);
  const result = await cloudApi.disconnect();

  if (result.ok) {
    context.setStatus(result.data);
  } else {
    context.setActionError(result.data.error ?? "Failed to disconnect DeskCue Cloud");
  }

  context.setSubmitting(false);
}

export async function updateSessionLabelDisclosure(
  enabled: boolean,
  context: CloudConnectionActionContext
) {
  context.setSubmitting(true);
  context.setActionError(null);
  const result = await cloudApi.updateSessionDisclosure({ enabled });

  if (result.ok) {
    context.setStatus(result.data);
  } else {
    context.setActionError(result.data.error ?? "Failed to update Cloud session label sharing");
  }

  context.setSubmitting(false);
}

export async function savePermissions(
  event: FormEvent,
  context: CloudConnectionActionContext
) {
  event.preventDefault();
  context.setPermissionsSubmitting(true);
  context.setPermissionsFeedback(null);
  const result = await cloudApi.updatePermissions(context.permissionDraft.permissions);

  if (result.ok) {
    context.setStatus(result.data);
    context.permissionDraft.commit(result.data);
    context.setPermissionsFeedback({ kind: "success", message: "Remote permissions saved." });
  } else {
    context.setPermissionsFeedback({
      kind: "error",
      message: result.data.error ?? "Failed to update Cloud remote permissions"
    });
  }

  context.setPermissionsSubmitting(false);
}

export async function cancelEnrollmentAttempt(context: CloudConnectionActionContext) {
  context.setSubmitting(true);
  context.setActionError(null);
  const result = await cloudApi.cancelEnrollmentAttempt();

  if (result.ok) {
    context.setEnrollmentAttempt(null);
  } else {
    context.setActionError(result.data.error ?? "Failed to cancel Cloud enrollment");
  }

  context.setSubmitting(false);
}
