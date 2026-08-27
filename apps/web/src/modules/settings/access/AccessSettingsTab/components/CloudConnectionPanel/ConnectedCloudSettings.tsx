import type { FormEvent } from "react";

import type {
  CloudConnectionStatusResponse,
  UpdateCloudPermissionsInput
} from "@deskcue/protocol";

import type { PermissionFeedback } from "./cloudConnectionPresentation";
import { PermissionFields, PermissionPresets } from "./PermissionControls";
import { enabledCapabilityLabel } from "./permissions";
import type { PermissionDraft } from "./permissions";
import styles from "./styles.module.scss";

export function ConnectedCloudSettings({
  actionError,
  loadError,
  onDisconnect,
  onPermissionChange,
  onSavePermissions,
  onSessionLabelDisclosureChange,
  permissionFeedback,
  permissions,
  permissionsDirty,
  permissionsSubmitting,
  status,
  statusAvailable,
  submitting
}: {
  actionError: string | null;
  loadError: string | null;
  onDisconnect(): void;
  onPermissionChange(patch: Partial<UpdateCloudPermissionsInput>): void;
  onSavePermissions(event: FormEvent): void;
  onSessionLabelDisclosureChange(enabled: boolean): void;
  permissionFeedback: PermissionFeedback | null;
  permissions: PermissionDraft;
  permissionsDirty: boolean;
  permissionsSubmitting: boolean;
  status: CloudConnectionStatusResponse;
  statusAvailable: boolean;
  submitting: boolean;
}) {
  return (
    <div className={styles.connectedSettings}>
      <form className={styles.permissionsEditor} onSubmit={onSavePermissions}>
        <div className={styles.sectionHeading}>
          <span>Remote permissions</span>
          <strong>Choose what this Cloud connection can request</strong>
        </div>
        <PermissionPresets
          disabled={permissionsSubmitting}
          onSelect={onPermissionChange}
          permissions={permissions}
        />
        <p className={styles.permissionsBoundary}>
          DeskCue Cloud cannot increase these permissions. Changes are accepted only from
          this machine in Settings → Access → Cloud.
        </p>
        <PermissionFields
          className={styles.permissionsGrid}
          disabled={permissionsSubmitting}
          fieldClassName={styles.permissionField}
          onChange={onPermissionChange}
          permissions={permissions}
        />
        <div className={styles.permissionsActions}>
          <span aria-live="polite">
            {permissionFeedback?.kind === "success" ? permissionFeedback.message : ""}
          </span>
          <button
            className={styles.connectButton}
            disabled={!permissionsDirty || permissionsSubmitting}
            type="submit"
          >
            {permissionsSubmitting ? "Saving…" : "Save permissions"}
          </button>
        </div>
        {permissionFeedback?.kind === "error" && (
          <p className={styles.error} role="alert">{permissionFeedback.message}</p>
        )}
      </form>

      <label className={styles.consentField}>
        <input
          checked={status.sessionLabelDisclosureEnabled}
          disabled={submitting}
          onChange={(event) => onSessionLabelDisclosureChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Share session and workspace names</strong>
          <small>
            Cloud saves only short session and workspace labels. Full paths, prompts,
            transcripts, and logs stay out of this saved snapshot
          </small>
        </span>
      </label>

      <div className={styles.action}>
        <div className={styles.connectionIdentity}>
          <strong>{status.displayName}</strong>
          <small>{status.cloudOrigin}</small>
          <ul className={styles.connectionTraits} aria-label="Cloud connection properties">
            <li>Encrypted local credential</li>
            <li>Outbound-only relay</li>
          </ul>
          <div className={styles.capabilitySummary}>
            <span>{statusAvailable && status.connected ? "Enabled capabilities" : "Saved permissions"}</span>
            <strong>{enabledCapabilityLabel(status)}</strong>
          </div>
        </div>
        <button
          className={styles.disconnectButton}
          disabled={submitting}
          onClick={onDisconnect}
          type="button"
        >
          Disconnect
        </button>
      </div>

      {(actionError || loadError) && (
        <p className={styles.error} role="alert">{actionError ?? loadError}</p>
      )}
    </div>
  );
}
