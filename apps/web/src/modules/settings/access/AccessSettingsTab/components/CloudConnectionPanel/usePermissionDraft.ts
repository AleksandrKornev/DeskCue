import { useEffect, useState } from "react";

import type { CloudConnectionStatusResponse } from "@deskcue/protocol";

import {
  arePermissionsEqual,
  FULL_ACCESS_PERMISSIONS,
  permissionsFromStatus
} from "./permissions";
import type { PermissionDraft } from "./permissions";

export function usePermissionDraft(
  status: CloudConnectionStatusResponse | null,
  hasCloudProfile: boolean,
  submitting: boolean,
  onChange: () => void
) {
  const [permissions, setPermissions] = useState<PermissionDraft>(FULL_ACCESS_PERMISSIONS);
  const [dirty, setDirty] = useState(false);
  const remoteControlEnabled = status?.remoteControlEnabled ?? false;
  const remoteFilesEnabled = status?.remoteFilesEnabled ?? false;
  const remotePreviewEnabled = status?.remotePreviewEnabled ?? false;
  const remoteReadEnabled = status?.remoteReadEnabled ?? false;

  useEffect(() => {
    if (!hasCloudProfile) {
      setPermissions(FULL_ACCESS_PERMISSIONS);
      setDirty(false);

      return;
    }

    if (dirty || submitting) return;

    setPermissions({
      allowRemoteControl: remoteControlEnabled,
      allowRemoteFiles: remoteFilesEnabled,
      allowRemotePreview: remotePreviewEnabled,
      allowRemoteRead: remoteReadEnabled
    });
  }, [
    dirty,
    hasCloudProfile,
    remoteControlEnabled,
    remoteFilesEnabled,
    remotePreviewEnabled,
    remoteReadEnabled,
    submitting
  ]);

  const actions = {
    commit(nextStatus: CloudConnectionStatusResponse): void {
      setPermissions(permissionsFromStatus(nextStatus));
      setDirty(false);
    },
    update(patch: Partial<PermissionDraft>): void {
      const next = { ...permissions, ...patch };

      setPermissions(next);

      setDirty(Boolean(hasCloudProfile && status && !arePermissionsEqual(
        next,
        permissionsFromStatus(status)
      )));
      onChange();
    }
  };

  return { commit: actions.commit, dirty, permissions, update: actions.update };
}
