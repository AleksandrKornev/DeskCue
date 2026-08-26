import type { CloudEnrollmentAttempt } from "@deskcue/protocol";

import {
  connectionDescription,
  connectionHeading
} from "./cloudConnectionPresentation";
import styles from "./styles.module.scss";

export function CloudConnectionOverview(props: {
  connected: boolean;
  enrollmentAttempt: CloudEnrollmentAttempt | null;
  hasCloudProfile: boolean;
  pendingEventCount: number;
}) {
  return (
    <>
      <div className={styles.buildNotice}>
        <span className={props.connected ? styles.buildDotConnected : styles.buildDot} aria-hidden="true" />
        <div>
          <strong>{connectionHeading(props.connected, props.hasCloudProfile)}</strong>
          <span>{connectionDescription(props)}</span>
        </div>
      </div>

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
