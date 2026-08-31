import { useEffect, useRef, useState } from "react";
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
  hasSavedAccessCredential,
  readConnectionPreparationKind,
  readConnectionPreparationRetryPath,
  readReturnPath
} from "./helpers";
import styles from "./styles.module.scss";

function retryAccessCheck() {
  clearConnectionPreparationFailure();
  const preparationRetryPath = readConnectionPreparationRetryPath(window.location.search);

  if (preparationRetryPath) {
    window.location.replace(preparationRetryPath);
    return;
  }

  window.location.reload();
}

function readRetryButtonLabel(
  canRetryPreparation: boolean,
  preparationKind: ReturnType<typeof readConnectionPreparationKind>,
  isPreparationFailure: boolean
) {
  if (isPreparationFailure) return "Check DeskCue access";
  if (canRetryPreparation && preparationKind === "pair") return "Retry pairing link";
  if (canRetryPreparation && preparationKind === "recover") return "Retry recovery code";
  if (!canRetryPreparation) return "Check access again";

  return "Try connection again";
}

function readAccessStateLabel(
  isOffline: boolean,
  isPreparationRetry: boolean,
  isPreparationFailure: boolean,
  hasRetryablePreparationFailure: boolean,
  isAcceptedPreparationFailure: boolean
) {
  if (isAcceptedPreparationFailure) return "Access setup incomplete";
  if (isPreparationFailure) return "One-time link failed";
  if (isOffline) return "Connection unavailable";
  if (hasRetryablePreparationFailure) return "One-time link needs retry";
  if (isPreparationRetry) return "One-time link ready";

  return "Access required";
}

function readAccessHeading(
  isOffline: boolean,
  isPreparationRetry: boolean,
  preparationKind: ReturnType<typeof readConnectionPreparationKind>
) {
  if (isOffline) return "Cannot reach DeskCue";
  if (isPreparationRetry && preparationKind === "pair") return "Retry pairing link";
  if (isPreparationRetry && preparationKind === "recover") return "Retry recovery code";

  return "Pair this browser";
}

export function AccessRequiredPage() {
  const location = useLocation();
  const [hasSavedCredential, setHasSavedCredential] = useState(hasSavedAccessCredential);
  const [clearStatus, setClearStatus] = useState("");
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const connectionPreparationFailure = readConnectionPreparationFailure();
  const hostAccessSettingsUrl = buildHostAccessSettingsUrl();
  const recoveryUrlExample = buildRecoveryUrlExample();
  const query = new URLSearchParams(location.search);
  const returnPath = readReturnPath(location.search);
  const isOffline = query.get("reason") === "offline";
  const preparationKind = returnPath ? readConnectionPreparationKind(returnPath) : null;
  const isPreparationRetry = query.get("reason") === "preparation" && Boolean(preparationKind);
  const isPreparationFailure = query.get("reason") === "preparation-failed" &&
    Boolean(connectionPreparationFailure);
  const isAcceptedPreparationFailure = isPreparationFailure &&
    connectionPreparationFailure?.requestAccepted === true;
  const hasRetryablePreparationFailure = isPreparationRetry &&
    connectionPreparationFailure?.retryOriginal === true;
  const isRecoveryState = isOffline || isPreparationRetry || isPreparationFailure;
  const accessStateLabel = readAccessStateLabel(
    isOffline,
    isPreparationRetry,
    isPreparationFailure,
    hasRetryablePreparationFailure,
    isAcceptedPreparationFailure
  );
  const accessHeading = isPreparationFailure
    ? connectionPreparationFailure?.title ?? "One-time link did not work"
    : readAccessHeading(isOffline, isPreparationRetry, preparationKind);
  const retryButtonLabel = readRetryButtonLabel(
    isRecoveryState,
    preparationKind,
    isPreparationFailure
  );
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!clearStatus) return;

    primaryButtonRef.current?.focus();
  }, [clearStatus]);

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <Link aria-label="Back to DeskCue dashboard" className={styles.logo} to="/">
          <DeskCueWordmark className={styles.logoWordmark} />
        </Link>
        <span className={styles.label}>{accessStateLabel}</span>
        <h1 ref={headingRef} tabIndex={-1}>{accessHeading}</h1>
        {isPreparationFailure ? (
          <>
            {isAcceptedPreparationFailure ? (
              <p>
                DeskCue accepted this one-time request, but this browser did not finish
                saving access. The original link will not be retried.
              </p>
            ) : (
              <p>
                DeskCue could not apply this one-time link. It will not be retried
                automatically.
              </p>
            )}
            <div className={styles.error} role="alert">
              <span>{connectionPreparationFailure?.message}</span>
            </div>
          </>
        ) : isPreparationRetry ? (
          hasRetryablePreparationFailure ? (
            <>
              <p>
                DeskCue has not applied this one-time{" "}
                {preparationKind === "pair" ? "pairing link" : "recovery code"}. You can try
                the original link again before creating a new one.
              </p>
              <div className={styles.error} role="alert">
                <span>{connectionPreparationFailure?.message}</span>
              </div>
            </>
          ) : (
            <p>
              DeskCue is reachable again, but this one-time{" "}
              {preparationKind === "pair" ? "pairing link" : "recovery code"} has not been
              retried. Retry it now to continue.
            </p>
          )
        ) : isOffline ? (
          <>
            <p>
              DeskCue could not verify browser access because the local daemon did not
              respond. Check that DeskCue is running and this address is reachable.
            </p>
            {hasSavedCredential ? (
              <div className={styles.offlineNotice}>
                <strong>Your saved browser access was not changed</strong>
                <span>
                  The daemon did not reject this credential. Try the connection again
                  before clearing or replacing access.
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <>
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
          </>
        )}

        <div className={styles.actions}>
          {!isRecoveryState && hasSavedCredential ? (
            <button
              className={styles.secondaryButton}
              onClick={() => {
                clearSavedAccessCredential();
                setHasSavedCredential(false);
                setClearStatus("Saved browser access cleared");
              }}
              type="button"
            >
              Clear saved access
            </button>
          ) : null}
          <button
            className={styles.primaryButton}
            onClick={retryAccessCheck}
            ref={primaryButtonRef}
            type="button"
          >
            {retryButtonLabel}
          </button>
        </div>
        <p aria-atomic="true" className={styles.liveStatus} role="status">{clearStatus}</p>

        {isRecoveryState ? null : (
          <>
            <section aria-labelledby="pairing-steps-heading" className={styles.pairingGuide}>
              <h2 id="pairing-steps-heading">Pairing steps</h2>
              <ol className={styles.steps} role="list">
                <li role="listitem">
                  <span aria-label="Step 1">1</span>
                  <p>
                    On the host computer, open <code>{hostAccessSettingsUrl}</code>
                  </p>
                </li>
                <li role="listitem">
                  <span aria-label="Step 2">2</span>
                  <p>Go to Connections and create a device pairing link</p>
                </li>
                <li role="listitem">
                  <span aria-label="Step 3">3</span>
                  <p>Open the pairing link in this browser to continue</p>
                </li>
              </ol>
            </section>

            <section aria-labelledby="recovery-heading" className={styles.recoveryPanel}>
              <h2 id="recovery-heading">Already have a recovery code?</h2>
              <p>
                Open <code>{recoveryUrlExample}</code> on this address, or append{" "}
                <code>?recovery=&lt;code&gt;</code>. Recovery codes are one-time restore links
                created from Settings &gt; Connections.
              </p>
            </section>
          </>
        )}

        {hasRetryablePreparationFailure ? null : isRecoveryState && preparationKind ? (
          <p className={styles.returnHint}>
            Retry opens the original one-time{" "}
            {preparationKind === "pair" ? "pairing link" : "recovery code"} and tries it again.
          </p>
        ) : returnPath ? (
          <p className={styles.returnHint}>
            If this access-check URL stays open during pairing, a successful check
            will return to the page you tried to open
          </p>
        ) : null}
      </section>
    </main>
  );
}
