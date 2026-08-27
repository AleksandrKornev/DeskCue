import type { FormEvent, SyntheticEvent } from "react";

import type {
  CloudEnrollmentAttempt,
  UpdateCloudPermissionsInput
} from "@deskcue/protocol";

import { PermissionFields, PermissionPresets } from "./PermissionControls";
import type { PermissionDraft } from "./permissions";
import styles from "./styles.module.scss";

interface CloudEnrollmentFormProps {
  actionError: string | null;
  advancedOpen: boolean;
  cloudOrigin: string;
  displayName: string;
  enrollmentAttempt: CloudEnrollmentAttempt | null;
  enrollmentTicket: string;
  loadError: string | null;
  loading: boolean;
  onAdvancedOpenChange(open: boolean): void;
  onCancelEnrollment(): void;
  onCloudOriginChange(value: string): void;
  onConnectCustom(event: SyntheticEvent): void;
  onDisplayNameChange(value: string): void;
  onEnrollmentTicketChange(value: string): void;
  onPermissionChange(patch: Partial<UpdateCloudPermissionsInput>): void;
  onStartEnrollment(event: FormEvent): void;
  permissions: PermissionDraft;
  submitting: boolean;
}

export function CloudEnrollmentForm({
  actionError,
  advancedOpen,
  cloudOrigin,
  displayName,
  enrollmentAttempt,
  enrollmentTicket,
  loadError,
  loading,
  onAdvancedOpenChange,
  onCancelEnrollment,
  onCloudOriginChange,
  onConnectCustom,
  onDisplayNameChange,
  onEnrollmentTicketChange,
  onPermissionChange,
  onStartEnrollment,
  permissions,
  submitting
}: CloudEnrollmentFormProps) {
  if (enrollmentAttempt) {
    return (
      <div className={styles.connectionForm}>
        <div className={styles.enrollmentPending}>
          <div>
            <strong>Waiting for approval</strong>
            <small>
              {enrollmentAttempt.lastErrorCode
                ? "Cloud is temporarily unreachable. DeskCue is retrying automatically."
                : "Complete sign-in in DeskCue Cloud. This daemon will connect automatically after approval."}
            </small>
          </div>
          <a href={enrollmentAttempt.verificationUrl} rel="noreferrer" target="_blank">
            Continue in Cloud
          </a>
          <button disabled={submitting} onClick={onCancelEnrollment} type="button">
            Cancel
          </button>
        </div>

        {(actionError || loadError) && (
          <p className={styles.error} role="alert">{actionError ?? loadError}</p>
        )}
      </div>
    );
  }

  return (
    <form className={styles.connectionForm} onSubmit={onStartEnrollment}>
      <div className={styles.enrollmentPermissions}>
        <div className={styles.sectionHeading}>
          <span>Cloud access</span>
          <strong>Choose what this connection can request</strong>
        </div>
        <PermissionPresets
          disabled={submitting}
          onSelect={onPermissionChange}
          permissions={permissions}
        />
        <p className={styles.permissionsBoundary}>
          DeskCue Cloud cannot grant itself more access. You can change these permissions
          later only on this machine in Settings → Connections → DeskCue Cloud.
        </p>
      </div>

      <PermissionFields
        disabled={submitting}
        fieldClassName={styles.consentField}
        onChange={onPermissionChange}
        permissions={permissions}
      />

      <label className={styles.field}>
        <span>Machine name</span>
        <input
          maxLength={120}
          onChange={(event) => onDisplayNameChange(event.target.value)}
          required
          value={displayName}
        />
      </label>

      <div className={styles.action}>
        <div>
          <strong>Connect with your DeskCue account</strong>
          <small>No ticket copying. Sign in, approve this machine, and the daemon connects automatically.</small>
        </div>
        <button className={styles.connectButton} disabled={submitting || loading} type="submit">
          {submitting ? "Opening Cloud…" : "Connect to DeskCue Cloud"}
        </button>
      </div>

      <button
        aria-expanded={advancedOpen}
        className={styles.advancedToggle}
        onClick={() => onAdvancedOpenChange(!advancedOpen)}
        type="button"
      >
        Custom or self-hosted Cloud
      </button>
      {advancedOpen && (
        <div className={styles.advancedFields}>
          <label className={styles.field}>
            <span>Cloud origin</span>
            <input
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="url"
              onChange={(event) => onCloudOriginChange(event.target.value)}
              placeholder="https://cloud.example.com"
              spellCheck={false}
              value={cloudOrigin}
            />
          </label>
          <label className={styles.field}>
            <span>Enrollment ticket</span>
            <input
              autoComplete="off"
              onChange={(event) => onEnrollmentTicketChange(event.target.value)}
              type="password"
              value={enrollmentTicket}
            />
          </label>
          <button
            className={styles.connectButton}
            disabled={submitting || !cloudOrigin.trim() || !enrollmentTicket.trim()}
            onClick={onConnectCustom}
            type="button"
          >
            Connect custom Cloud
          </button>
        </div>
      )}

      {(actionError || loadError) && (
        <p className={styles.error} role="alert">{actionError ?? loadError}</p>
      )}
    </form>
  );
}
