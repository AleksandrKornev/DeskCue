import type {
  CloudConnectorState,
  CloudEnrollmentAttempt
} from "@deskcue/protocol";

import {
  connectionDescription,
  connectionHeading
} from "./cloudConnectionPresentation";
import styles from "./styles.module.scss";

function CloudConnectionArchitecture() {
  return (
    <>
      <section className={styles.modalSection}>
        <div className={styles.sectionHeading}>
          <span>Connection path</span>
          <strong>Outbound-only flow</strong>
        </div>
        <ol className={styles.flow} aria-label="DeskCue Cloud connection flow">
          <li>
            <span>1</span>
            <div>
              <strong>Local daemon</strong>
              <small>Source of truth for agents, files, permissions, and runtime credentials</small>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <strong>Authenticated outbound channel</strong>
              <small>The daemon connects out; no inbound port is required</small>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <strong>DeskCue Cloud</strong>
              <small>Optional control and reachability plane</small>
            </div>
          </li>
          <li>
            <span>4</span>
            <div>
              <strong>Paired devices</strong>
              <small>Remote review through scoped, revocable access</small>
            </div>
          </li>
        </ol>
      </section>

      <div className={styles.dataBoundary}>
        <strong>Local-first data boundary</strong>
        <ul>
          <li>
            <span>Synced by default</span>
            Machine and session status metadata.
          </li>
          <li>
            <span>Passed through on request</span>
            Transcripts, diffs, and separately granted workspace files. Cloud does not persist them.
          </li>
          <li>
            <span>Stays local</span>
            Provider credentials. This version is not end-to-end encrypted.
          </li>
        </ul>
      </div>
    </>
  );
}

export function CloudConnectionOverview(props: {
  connected: boolean;
  enrollmentAttempt: CloudEnrollmentAttempt | null;
  hasCloudProfile: boolean;
  loading: boolean;
  pendingEventCount: number;
  statusKnown: boolean;
  statusAvailable: boolean;
  state: CloudConnectorState | undefined;
}) {
  const dotClass = !props.statusAvailable || !props.hasCloudProfile
    ? styles.buildDot
    : props.connected
      ? styles.buildDotConnected
      : props.state === "revoked"
        ? styles.buildDotRevoked
        : styles.buildDotReconnecting;

  return (
    <>
      <div className={styles.buildNotice}>
        <span className={dotClass} aria-hidden="true" />
        <div>
          <strong>{connectionHeading(
            props.connected,
            props.hasCloudProfile,
            props.loading,
            props.statusAvailable,
            props.state
          )}</strong>
          <span>{connectionDescription(props)}</span>
        </div>
      </div>

      {!props.statusKnown ? null : props.hasCloudProfile ? (
        <details className={styles.connectionExplainer}>
          <summary>
            <span className={styles.connectionExplainerEyebrow}>
              Connection and data boundaries
            </span>
            <strong>How DeskCue Cloud connects and what stays local</strong>
            <span
              aria-hidden="true"
              className={styles.connectionExplainerIndicator}
            />
          </summary>
          <div className={styles.connectionExplainerContent}>
            <CloudConnectionArchitecture />
          </div>
        </details>
      ) : (
        <CloudConnectionArchitecture />
      )}
    </>
  );
}
