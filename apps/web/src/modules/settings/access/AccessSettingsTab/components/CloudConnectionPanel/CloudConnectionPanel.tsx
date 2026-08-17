import type { FormEvent, SyntheticEvent } from "react";
import { useEffect, useState } from "react";

import type { CloudEnrollmentAttempt } from "@deskcue/protocol";
import { cloudApi } from "@api/endpoint/cloud/endpoints";
import { Modal } from "@components/Modal";
import { useCloudConnectionStatus } from "@modules/cloudConnection/model/useCloudConnectionStatus";

import { CloudConnectionOverview } from "./CloudConnectionOverview";
import { CloudConnectionSummary } from "./CloudConnectionSummary";
import { CloudEnrollmentForm } from "./CloudEnrollmentForm";
import { ConnectedCloudSettings } from "./ConnectedCloudSettings";
import type { PermissionFeedback } from "./ConnectedCloudSettings";
import styles from "./styles.module.scss";
import { usePermissionDraft } from "./usePermissionDraft";

const OFFICIAL_CLOUD_ORIGIN = import.meta.env.VITE_DESKCUE_CLOUD_ORIGIN ?? "https://app.deskcue.io";
const ENROLLMENT_STATUS_REFRESH_MS = 2_000;

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

  useEffect(() => {
    if (!hasCloudProfile) setPermissionsFeedback(null);
  }, [hasCloudProfile]);

  useEffect(() => {
    if (!detailsOpen || hasCloudProfile) return;
    let active = true;

    const refreshAttempt = async () => {
      try {
        const response = await cloudApi.getEnrollmentAttempt();
        if (!active) return;
        setEnrollmentAttempt(response.attempt);
        if (!response.attempt) await refresh();
      } catch {
        // The main connection status already surfaces daemon reachability errors.
      }
    };

    void refreshAttempt();
    const timer = window.setInterval(() => void refreshAttempt(), ENROLLMENT_STATUS_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [detailsOpen, hasCloudProfile, refresh]);

  async function startEnrollmentAttempt(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setActionError(null);
    const verificationWindow = window.open("about:blank", "_blank");
    if (verificationWindow) verificationWindow.opener = null;
    const result = await cloudApi.startEnrollmentAttempt({
      ...permissionDraft.permissions,
      cloudOrigin: OFFICIAL_CLOUD_ORIGIN,
      displayName
    });
    if (result.ok && result.data.attempt) {
      setEnrollmentAttempt(result.data.attempt);
      if (verificationWindow) {
        verificationWindow.location.href = result.data.attempt.verificationUrl;
      } else {
        window.location.assign(result.data.attempt.verificationUrl);
      }
    } else {
      verificationWindow?.close();
      setActionError(result.ok
        ? "DeskCue Cloud did not return an enrollment attempt"
        : result.data.error ?? "Failed to start DeskCue Cloud enrollment");
    }
    setSubmitting(false);
  }

  async function submitConnection(event: SyntheticEvent) {
    event.preventDefault();
    setSubmitting(true);
    setActionError(null);
    const result = await cloudApi.connect({
      ...permissionDraft.permissions,
      cloudOrigin,
      displayName,
      enrollmentTicket
    });
    if (result.ok) {
      setStatus(result.data);
      setEnrollmentTicket("");
      await refresh();
    } else {
      setActionError(result.data.error ?? "Failed to connect to DeskCue Cloud");
    }
    setSubmitting(false);
  }

  async function disconnect() {
    setSubmitting(true);
    setActionError(null);
    const result = await cloudApi.disconnect();
    if (result.ok) {
      setStatus(result.data);
    } else {
      setActionError(result.data.error ?? "Failed to disconnect DeskCue Cloud");
    }
    setSubmitting(false);
  }

  async function updateSessionLabelDisclosure(enabled: boolean) {
    setSubmitting(true);
    setActionError(null);
    const result = await cloudApi.updateSessionDisclosure({ enabled });
    if (result.ok) {
      setStatus(result.data);
    } else {
      setActionError(result.data.error ?? "Failed to update Cloud session label sharing");
    }
    setSubmitting(false);
  }

  async function savePermissions(event: FormEvent) {
    event.preventDefault();
    setPermissionsSubmitting(true);
    setPermissionsFeedback(null);
    const result = await cloudApi.updatePermissions(permissionDraft.permissions);
    if (result.ok) {
      setStatus(result.data);
      permissionDraft.commit(result.data);
      setPermissionsFeedback({ kind: "success", message: "Remote permissions saved." });
    } else {
      setPermissionsFeedback({
        kind: "error",
        message: result.data.error ?? "Failed to update Cloud remote permissions"
      });
    }
    setPermissionsSubmitting(false);
  }

  async function cancelEnrollmentAttempt() {
    setSubmitting(true);
    setActionError(null);
    const result = await cloudApi.cancelEnrollmentAttempt();
    if (result.ok) {
      setEnrollmentAttempt(null);
    } else {
      setActionError(result.data.error ?? "Failed to cancel Cloud enrollment");
    }
    setSubmitting(false);
  }

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
            onDisconnect={() => void disconnect()}
            onPermissionChange={permissionDraft.update}
            onSavePermissions={(event) => void savePermissions(event)}
            onSessionLabelDisclosureChange={(enabled) => void updateSessionLabelDisclosure(enabled)}
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
            onCancelEnrollment={() => void cancelEnrollmentAttempt()}
            onCloudOriginChange={setCloudOrigin}
            onConnectCustom={(event) => void submitConnection(event)}
            onDisplayNameChange={setDisplayName}
            onEnrollmentTicketChange={setEnrollmentTicket}
            onPermissionChange={permissionDraft.update}
            onStartEnrollment={(event) => void startEnrollmentAttempt(event)}
            permissions={permissionDraft.permissions}
            submitting={submitting}
          />
        )}
      </Modal>
    </>
  );
}
