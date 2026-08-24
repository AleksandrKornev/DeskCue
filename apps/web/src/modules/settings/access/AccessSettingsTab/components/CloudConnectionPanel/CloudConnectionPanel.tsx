import { useEffect, useState } from "react";

import type { CloudEnrollmentAttempt } from "@deskcue/protocol";
import { Modal } from "@components/Modal";
import { useCloudConnectionStatus } from "@modules/cloudConnection/model/useCloudConnectionStatus";

import {
  cancelEnrollmentAttempt,
  disconnect,
  refreshEnrollmentAttempt,
  savePermissions,
  startEnrollmentAttempt,
  submitConnection,
  updateSessionLabelDisclosure
} from "./actions/cloudConnectionActions";
import type { CloudConnectionActionContext } from "./actions/cloudConnectionActions";
import { CloudConnectionOverview } from "./CloudConnectionOverview";
import { ENROLLMENT_STATUS_REFRESH_MS } from "./cloudConnectionPresentation";
import type { PermissionFeedback } from "./cloudConnectionPresentation";
import { CloudConnectionSummary } from "./CloudConnectionSummary";
import { CloudEnrollmentForm } from "./CloudEnrollmentForm";
import { ConnectedCloudSettings } from "./ConnectedCloudSettings";
import styles from "./styles.module.scss";
import { usePermissionDraft } from "./usePermissionDraft";

export function CloudConnectionPanel() {
  const { error: loadError, loading, refresh, setStatus, status } = useCloudConnectionStatus();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cloudOrigin, setCloudOrigin] = useState("");
  const [displayName, setDisplayName] = useState("DeskCue machine");
  const [enrollmentTicket, setEnrollmentTicket] = useState("");
  const [enrollmentAttempt, setEnrollmentAttempt] = useState<CloudEnrollmentAttempt | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [permissionsSubmitting, setPermissionsSubmitting] = useState(false);
  const [permissionsFeedback, setPermissionsFeedback] = useState<PermissionFeedback | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const hasCloudProfile = status?.enabled === true;
  const isConnected = status?.connected === true;
  const permissionDraft = usePermissionDraft(
    status,
    hasCloudProfile,
    permissionsSubmitting,
    () => setPermissionsFeedback(null)
  );
  const actionContext: CloudConnectionActionContext = {
    cloudOrigin,
    displayName,
    enrollmentTicket,
    permissionDraft,
    refresh,
    setActionError,
    setEnrollmentAttempt,
    setEnrollmentTicket,
    setPermissionsFeedback,
    setPermissionsSubmitting,
    setStatus,
    setSubmitting
  };

  useEffect(() => {
    if (!hasCloudProfile) setPermissionsFeedback(null);
  }, [hasCloudProfile]);

  useEffect(() => {
    if (!detailsOpen || hasCloudProfile) return;

    const activeRef = { current: true };
    const refreshContext = { refresh, setEnrollmentAttempt };

    void refreshEnrollmentAttempt(activeRef, refreshContext);
    const timer = window.setInterval(
      () => void refreshEnrollmentAttempt(activeRef, refreshContext),
      ENROLLMENT_STATUS_REFRESH_MS
    );

    return () => {
      activeRef.current = false;
      window.clearInterval(timer);
    };
  }, [detailsOpen, hasCloudProfile, refresh]);

  return (
    <>
      <CloudConnectionSummary
        connected={isConnected}
        onOpen={() => setDetailsOpen(true)}
        open={detailsOpen}
        state={status?.state}
      />

      <Modal
        bodyClassName={styles.modalBody}
        className={styles.cloudModal}
        description="Optional remote access without changing local-first ownership."
        eyebrow="Connections"
        isOpen={detailsOpen}
        title="DeskCue Cloud"
        onClose={() => setDetailsOpen(false)}
      >
        <CloudConnectionOverview
          connected={isConnected}
          enrollmentAttempt={enrollmentAttempt}
          hasCloudProfile={hasCloudProfile}
          pendingEventCount={status?.pendingEventCount ?? 0}
        />

        {hasCloudProfile && status ? (
          <ConnectedCloudSettings
            actionError={actionError}
            loadError={loadError}
            onDisconnect={() => void disconnect(actionContext)}
            onPermissionChange={permissionDraft.update}
            onSavePermissions={(event) => void savePermissions(event, actionContext)}
            onSessionLabelDisclosureChange={(enabled) => void updateSessionLabelDisclosure(
              enabled,
              actionContext
            )}
            permissionFeedback={permissionsFeedback}
            permissions={permissionDraft.permissions}
            permissionsDirty={permissionDraft.dirty}
            permissionsSubmitting={permissionsSubmitting}
            status={status}
            submitting={submitting}
          />
        ) : (
          <CloudEnrollmentForm
            actionError={actionError}
            advancedOpen={advancedOpen}
            cloudOrigin={cloudOrigin}
            displayName={displayName}
            enrollmentAttempt={enrollmentAttempt}
            enrollmentTicket={enrollmentTicket}
            loadError={loadError}
            loading={loading}
            onAdvancedOpenChange={setAdvancedOpen}
            onCancelEnrollment={() => void cancelEnrollmentAttempt(actionContext)}
            onCloudOriginChange={setCloudOrigin}
            onConnectCustom={(event) => void submitConnection(event, actionContext)}
            onDisplayNameChange={setDisplayName}
            onEnrollmentTicketChange={setEnrollmentTicket}
            onPermissionChange={permissionDraft.update}
            onStartEnrollment={(event) => void startEnrollmentAttempt(event, actionContext)}
            permissions={permissionDraft.permissions}
            submitting={submitting}
          />
        )}
      </Modal>
    </>
  );
}
