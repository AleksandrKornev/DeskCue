import { useCallback, useState } from "react";
import { Link, useLocation } from "react-router";

import {
  clearConnectionPreparationFailure,
  readConnectionPreparationFailure
} from "@api/connection/pairing";
import { DeskCueWordmark } from "@components/DeskCueWordmark";

import {
  buildHostAccessSettingsUrl,
  buildRecoveryUrlExample,
  clearSavedAccessCredential,
  hasSavedAccessCredential
} from "./helpers";
import styles from "./styles.module.scss";

export function AccessRequiredPage() {
  const location = useLocation();
  const [hasSavedCredential, setHasSavedCredential] = useState(hasSavedAccessCredential);
  const connectionPreparationFailure = readConnectionPreparationFailure();
  const hostAccessSettingsUrl = buildHostAccessSettingsUrl();
  const recoveryUrlExample = buildRecoveryUrlExample();
  const from = new URLSearchParams(location.search).get("from");

  const handleClearSavedCredential = useCallback(() => {
    clearSavedAccessCredential();
    setHasSavedCredential(false);
  }, []);

  const handleRetry = useCallback(() => {
    clearConnectionPreparationFailure();
    window.location.reload();
  }, []);

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <Link className={styles.logo} to="/">
          <DeskCueWordmark className={styles.logoWordmark} />
        </Link>
        <span className={styles.label}>Access required</span>
        <h1>Pair this browser</h1>
        <p>
          This DeskCue instance requires an access token. Open the local DeskCue page on
          the host computer, create a device pairing link, then open that link here.
        </p>
        <p className={styles.originHint}>
          Browser access is saved per address and origin. Opening DeskCue through a
          different address is treated as a separate client, even in the same browser.
        </p>
        {hasSavedCredential ? (
          <div className={styles.warning}>
            <strong>Saved browser access no longer works</strong>
            <span>
              This address has a saved DeskCue marker, but the API rejected the current
              request. Pair or recover this address again; active tokens on the host do
              not prove this browser still has its local credential.
            </span>
          </div>
        ) : null}

        {connectionPreparationFailure ? (
          <div className={styles.error} role="alert">
            <strong>{connectionPreparationFailure.title}</strong>
            <span>{connectionPreparationFailure.message}</span>
          </div>
        ) : null}

        <div className={styles.actions}>
          {hasSavedCredential ? (
            <button
              className={styles.secondaryButton}
              onClick={handleClearSavedCredential}
              type="button"
            >
              Clear saved access
            </button>
          ) : null}
          <button className={styles.primaryButton} onClick={handleRetry} type="button">
            Retry
          </button>
        </div>

        <div className={styles.steps}>
          <div>
            <span>1</span>
            <p>
              On the host computer, open <code>{hostAccessSettingsUrl}</code>
            </p>
          </div>
          <div>
            <span>2</span>
            <p>Go to Connections and create a device pairing link</p>
          </div>
          <div>
            <span>3</span>
            <p>Open the pairing link in this browser to continue</p>
          </div>
        </div>

        <div className={styles.recoveryPanel}>
          <strong>Already have a recovery code?</strong>
          <p>
            Open <code>{recoveryUrlExample}</code> on this address, or append{" "}
            <code>?recovery=&lt;code&gt;</code>. Recovery codes are one-time restore links
            created from Settings &gt; Connections.
          </p>
        </div>

        {from ? (
          <p className={styles.returnHint}>
            After pairing, DeskCue will use the original page again
          </p>
        ) : null}
      </section>
    </main>
  );
}
