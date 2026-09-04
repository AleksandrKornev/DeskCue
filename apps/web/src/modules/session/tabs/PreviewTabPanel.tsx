import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";

import { getDeskCueRuntime } from "@runtime";

import { usesInsecureNetworkOrigin } from "./helpers";
import { PreviewConnectionForm, PreviewToolbarIcon } from "./preview";
import { resolvePreviewFrameUrl } from "./preview/previewUrlIdentity";
import styles from "./styles.module.scss";
import type { PreviewTabPanelProps } from "./types";

const STOP_PREVIEW_ERROR = "Could not stop preview";

type StopPreviewArgs = {
  onStopPreview: PreviewTabPanelProps["onStopPreview"];
  setStopError: (value: string) => void;
  setStoppingPreview: (value: boolean) => void;
};

type PreviewFocusOperation = {
  focusMoved: boolean;
  kind: "reload" | "retry";
  origin: HTMLButtonElement;
};

type PreviewConnectionFocusHandoff = {
  frameKey: string;
};

function canRestorePreviewFocus(operation: PreviewFocusOperation) {
  const activeElement = document.activeElement;

  return !operation.focusMoved &&
    (activeElement === document.body || activeElement === operation.origin);
}

function focusPreviewRecoveryConnection(container: HTMLDivElement | null) {
  const manualPortDetails = container?.querySelector("details");
  const focusTarget = manualPortDetails?.open
    ? manualPortDetails.querySelector<HTMLInputElement>('input[name="previewPort"]')
    : manualPortDetails?.querySelector<HTMLElement>("summary");

  focusTarget?.focus();
}

async function stopPreview({
  onStopPreview,
  setStopError,
  setStoppingPreview
}: StopPreviewArgs) {
  setStopError("");
  setStoppingPreview(true);

  try {
    const stopped = await onStopPreview();

    if (!stopped) setStopError(STOP_PREVIEW_ERROR);
  } catch {
    setStopError(STOP_PREVIEW_ERROR);
  } finally {
    setStoppingPreview(false);
  }
}

export function PreviewTabPanel({
  configuredPreviewNetworkMode,
  configuredPreviewPort,
  hasSelectedSession,
  previewCandidates,
  previewCandidatesError,
  previewCandidatesLoading,
  previewDocumentRevision,
  previewError,
  previewLoading,
  previewPort,
  previewReloadVersion,
  previewUrl,
  onChangePreviewPort,
  onChangePreviewNetworkMode,
  onLaunchPreview,
  onReloadPreview,
  onRetryPreview,
  onSetPreview,
  onStopPreview,
}: PreviewTabPanelProps) {
  const canManagePreview = getDeskCueRuntime().features.previewControl;
  const isPreviewActive = typeof configuredPreviewPort === "number" && configuredPreviewPort > 0;
  const activePreviewError = isPreviewActive ? previewError : "";
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [focusHandoffTarget, setFocusHandoffTarget] = useState<"reload" | "retry" | null>(null);
  const [loadedFrameKey, setLoadedFrameKey] = useState("");
  const [launchError, setLaunchError] = useState("");
  const [launchingPreview, setLaunchingPreview] = useState(false);
  const [stopError, setStopError] = useState("");
  const [stoppingPreview, setStoppingPreview] = useState(false);
  const [storedFrameUrl, setStoredFrameUrl] = useState<string | null>(previewUrl);
  const connectionFocusHandoffRef = useRef<PreviewConnectionFocusHandoff | null>(null);
  const connectionPanelRef = useRef<HTMLDivElement | null>(null);
  const focusOperationRef = useRef<PreviewFocusOperation | null>(null);
  const recoveryConnectionRef = useRef<HTMLDivElement | null>(null);
  const reloadButtonRef = useRef<HTMLButtonElement | null>(null);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const frameUrl = resolvePreviewFrameUrl(storedFrameUrl, previewUrl);
  const frameKey = `${frameUrl ?? ""}:${previewDocumentRevision}:${previewReloadVersion}`;
  const frameKeyRef = useRef(frameKey);
  const frameReady = Boolean(frameUrl) && loadedFrameKey === frameKey;
  const hasLimitedBrowserFeatures = usesInsecureNetworkOrigin(frameUrl ?? previewUrl);
  const isHostLaunchedPreview = isPreviewActive && onLaunchPreview !== undefined;
  const hasPreviewSurface = Boolean(previewUrl) || isHostLaunchedPreview;
  const hasPreviewControls = hasPreviewSurface || Boolean(isPreviewActive && activePreviewError);
  const canStopPreview = isPreviewActive && canManagePreview;
  const hasPreviewStatusError = Boolean(activePreviewError || (stopError && isPreviewActive));
  const previewBusy = !hasPreviewStatusError
    && (stoppingPreview || previewLoading || (Boolean(previewUrl) && !frameReady));
  const previewStatus = stoppingPreview
    ? `Stopping preview · port ${configuredPreviewPort}`
    : stopError && isPreviewActive
      ? STOP_PREVIEW_ERROR
      : isPreviewActive && previewLoading
        ? "Checking preview…"
        : activePreviewError
          ? "Preview unavailable"
          : previewUrl && configuredPreviewPort
            ? frameReady ? `Loaded · port ${configuredPreviewPort}` : `Loading · port ${configuredPreviewPort}`
            : isPreviewActive
              ? `Configured on port ${configuredPreviewPort}`
              : "Preview is off";
  const compactPreviewStatus = stoppingPreview
    ? "Stopping"
    : stopError && isPreviewActive
      ? "Stop failed"
      : activePreviewError
        ? "Offline"
        : isPreviewActive && previewLoading
          ? "Checking"
          : previewUrl && configuredPreviewPort
            ? frameReady ? `:${configuredPreviewPort}` : "Loading"
            : configuredPreviewPort
              ? `:${configuredPreviewPort}`
              : "Off";

  useLayoutEffect(() => {
    frameKeyRef.current = frameKey;
  }, [frameKey]);

  useLayoutEffect(() => {
    if (storedFrameUrl !== frameUrl) setStoredFrameUrl(frameUrl);
  }, [frameUrl, storedFrameUrl]);

  useLayoutEffect(() => {
    setStopError("");
    focusOperationRef.current = null;
    setFocusHandoffTarget(null);
  }, [configuredPreviewPort]);

  useLayoutEffect(() => {
    if (!activePreviewError) return;

    const connectionLostFocus = Boolean(
      connectionOpen || connectionFocusHandoffRef.current
    ) && document.activeElement === document.body;

    connectionFocusHandoffRef.current = null;
    setConnectionOpen(false);
    if (connectionLostFocus) focusPreviewRecoveryConnection(recoveryConnectionRef.current);
  }, [activePreviewError, connectionOpen]);

  useLayoutEffect(() => {
    const handoff = connectionFocusHandoffRef.current;

    if (handoff && frameReady && handoff.frameKey !== frameKey) {
      connectionFocusHandoffRef.current = null;
    }
  }, [frameKey, frameReady]);

  useLayoutEffect(() => {
    const operation = focusOperationRef.current;

    if (!activePreviewError || !operation) return;

    focusOperationRef.current = null;
    if (!canRestorePreviewFocus(operation)) return;

    setFocusHandoffTarget("retry");
    retryButtonRef.current?.focus();
  }, [activePreviewError]);

  useLayoutEffect(() => {
    const operation = focusOperationRef.current;

    if (
      operation?.kind !== "retry" ||
      !previewUrl ||
      previewLoading ||
      activePreviewError
    ) {
      return;
    }

    focusOperationRef.current = null;
    if (!canRestorePreviewFocus(operation)) return;

    setFocusHandoffTarget("reload");
    reloadButtonRef.current?.focus();
  }, [activePreviewError, previewLoading, previewUrl]);

  useLayoutEffect(() => {
    if (frameReady && focusOperationRef.current?.kind === "reload") {
      focusOperationRef.current = null;
    }
  }, [frameReady]);

  return (
    <div
      className={clsx(
        styles.previewReview,
        hasPreviewControls && connectionOpen && !activePreviewError
          && styles.previewReviewConnectionOpen
      )}
      onFocusCapture={() => {
        const operation = focusOperationRef.current;

        if (operation && document.activeElement !== operation.origin) operation.focusMoved = true;
      }}
    >
      <div className={styles.previewReviewToolbar}>
        <div className={styles.previewStatusGroup}>
          <div aria-label={previewStatus} className={styles.previewReviewStatus} role="status">
            <span
              aria-hidden="true"
              className={clsx(
                styles.previewStatusDot,
                hasPreviewStatusError && styles.previewStatusDotUnavailable,
                previewBusy && styles.previewStatusDotBusy,
                previewUrl && frameReady && !stoppingPreview && !hasPreviewStatusError
                  && styles.previewStatusDotLive
              )}
            />
            <span className={styles.previewStatusLong}>{previewStatus}</span>
            <span className={styles.previewStatusCompact}>{compactPreviewStatus}</span>
          </div>
          {canStopPreview ? (
            <button
              aria-label={stoppingPreview ? "Stopping preview" : "Stop preview"}
              aria-busy={stoppingPreview}
              className={clsx(styles.previewToolbarButton, styles.previewToolbarButtonStop)}
              disabled={stoppingPreview}
              onClick={() => {
                setConnectionOpen(false);
                void stopPreview({ onStopPreview, setStopError, setStoppingPreview });
              }}
              title="Stop DeskCue preview without stopping the local app"
              type="button"
            >
              <PreviewToolbarIcon kind="stop" />
              <span className={styles.previewToolbarText}>{stoppingPreview ? "Stopping…" : "Stop"}</span>
            </button>
          ) : null}
        </div>

        {hasPreviewControls ? (
          <div className={styles.previewToolbarActions}>
            {previewUrl ? (
              <button
                aria-label="Reload"
                className={clsx(
                  styles.previewToolbarButton,
                  focusHandoffTarget === "reload" && styles.previewFocusHandoff
                )}
                disabled={stoppingPreview || previewLoading}
                onBlur={() => {
                  if (focusHandoffTarget === "reload") setFocusHandoffTarget(null);
                }}
                onClick={(event) => {
                  focusOperationRef.current = {
                    focusMoved: false,
                    kind: "reload",
                    origin: event.currentTarget
                  };

                  setFocusHandoffTarget(null);
                  onReloadPreview();
                }}
                ref={reloadButtonRef}
                type="button"
              >
                <PreviewToolbarIcon kind="reload" />
                <span className={styles.previewToolbarText}>Reload</span>
              </button>
            ) : null}
            {canManagePreview ? <button
              aria-label="Preview connection"
              aria-expanded={Boolean(activePreviewError) || connectionOpen}
              className={clsx(
                styles.previewToolbarButton,
                (connectionOpen || activePreviewError) && styles.previewToolbarButtonActive
              )}
              disabled={stoppingPreview}
              onClick={() => {
                if (activePreviewError) {
                  focusPreviewRecoveryConnection(recoveryConnectionRef.current);
                  return;
                }

                setConnectionOpen((value) => !value);
              }}
              type="button"
            >
              <PreviewToolbarIcon kind="connection" />
              <span className={styles.previewToolbarText}>Connection</span>
            </button> : null}
            {previewUrl ? (
              <a aria-label="Open preview in a new tab" className={styles.previewToolbarButton} href={previewUrl} rel="noreferrer" target="_blank">
                <PreviewToolbarIcon kind="open" />
                <span className={styles.previewToolbarText}>Open</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasPreviewControls && canManagePreview && connectionOpen && !activePreviewError ? (
        <div className={styles.previewConnectionPanel} ref={connectionPanelRef}>
          <div>
            <strong>Preview connection</strong>
            <p>The local app always stays behind DeskCue. Choose where its external requests should run, or switch the local port.</p>
          </div>
          <PreviewConnectionForm
            compact
            configuredPreviewPort={configuredPreviewPort}
            previewCandidates={previewCandidates}
            previewCandidatesError={previewCandidatesError}
            previewCandidatesLoading={previewCandidatesLoading}
            previewNetworkMode={configuredPreviewNetworkMode}
            previewPort={previewPort}
            submitLabel="Switch preview"
            onChangePreviewPort={onChangePreviewPort}
            onChangePreviewNetworkMode={onChangePreviewNetworkMode}
            onSubmit={async (event) => {
              if (connectionPanelRef.current?.contains(document.activeElement)) {
                connectionFocusHandoffRef.current = { frameKey };
              }

              await onSetPreview(event);
              setConnectionOpen(false);
            }}
          />
        </div>
      ) : null}

      {!hasSelectedSession || (isPreviewActive && previewLoading) ? (
        <div
          aria-hidden={hasSelectedSession ? true : undefined}
          aria-label={hasSelectedSession ? undefined : "Opening preview"}
          className={clsx(styles.skeletonBlock, styles.previewLoading)}
          role={hasSelectedSession ? undefined : "status"}
        />
      ) : activePreviewError ? (
        <div className={styles.previewEmptyState}>
          <div role="alert">
            <strong>Preview could not connect</strong>
            <p>{activePreviewError} Start the configured app and retry, or switch to another local app.</p>
          </div>
          <div className={styles.previewRecoveryActions} ref={recoveryConnectionRef}>
            <button
              className={clsx(
                styles.smallGhostButton,
                focusHandoffTarget === "retry" && styles.previewFocusHandoff
              )}
              onBlur={() => {
                if (focusHandoffTarget === "retry") setFocusHandoffTarget(null);
              }}
              onClick={(event) => {
                focusOperationRef.current = {
                  focusMoved: false,
                  kind: "retry",
                  origin: event.currentTarget
                };

                setFocusHandoffTarget(null);
                onRetryPreview();
              }}
              ref={retryButtonRef}
              type="button"
            >
              Retry current port
            </button>
            {canManagePreview ? (
              <PreviewConnectionForm
                configuredPreviewPort={configuredPreviewPort}
                previewCandidates={previewCandidates}
                previewCandidatesError={previewCandidatesError}
                previewCandidatesLoading={previewCandidatesLoading}
                previewNetworkMode={configuredPreviewNetworkMode}
                previewPort={previewPort}
                submitLabel="Switch preview"
                onChangePreviewPort={onChangePreviewPort}
                onChangePreviewNetworkMode={onChangePreviewNetworkMode}
                onSubmit={onSetPreview}
              />
            ) : null}
          </div>
        </div>
      ) : previewUrl ? (
        <div className={styles.previewCanvas}>
          <div className={styles.previewShellCanvas}>
            {hasLimitedBrowserFeatures ? (
              <aside
                aria-label="Limited browser features"
                className={styles.previewSecureContextWarning}
                role="note"
              >
                <strong>Some browser features need HTTPS</strong>
                <p>
                  Web Crypto, Service Workers, camera access, and WebAuthn may be
                  unavailable on this HTTP address. Preview can still work without them.
                </p>
              </aside>
            ) : null}
            <div className={styles.previewShellViewport}>
              <iframe
                key={frameKey}
                className={clsx(
                  styles.previewShellFrame,
                  frameReady && styles.previewShellFrameReady
                )}
                onLoad={() => {
                  if (frameKeyRef.current !== frameKey) return;

                  setLoadedFrameKey(frameKey);
                }}
                sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
                src={frameUrl ?? previewUrl}
                title="DeskCue preview"
              />
              {!frameReady ? (
                <div aria-hidden="true" className={styles.previewFrameLoading} data-testid="preview-frame-loading" />
              ) : null}
            </div>
          </div>
        </div>
      ) : isHostLaunchedPreview ? (
        <div className={clsx(styles.previewEmptyState, styles.previewHostLaunchState)}>
          <div>
            <strong>Preview is ready</strong>
            <p>
              Open the app in an isolated Cloud Preview tab. The browser never connects
              directly to the workspace machine&apos;s localhost.
            </p>
            {launchError ? <p className={styles.previewDiscoveryError} role="alert">{launchError}</p> : null}
          </div>
          <button
            className={styles.primaryButton}
            disabled={launchingPreview}
            onClick={() => {
              setLaunchError("");
              setLaunchingPreview(true);
              void onLaunchPreview().catch((error: unknown) => {
                setLaunchError(error instanceof Error ? error.message : "Failed to open Cloud Preview");
              }).finally(() => setLaunchingPreview(false));
            }}
            type="button"
          >
            {launchingPreview ? "Opening…" : "Open Cloud Preview"}
          </button>
        </div>
      ) : (
        <div
          aria-busy={previewCandidatesLoading}
          className={clsx(styles.previewEmptyState, styles.previewSetupState)}
        >
          <div className={styles.previewSetupSummary}>
            <span className={styles.previewSetupEyebrow}>Preview setup</span>
            <strong>
              {previewCandidatesLoading
                ? "Looking for a running app…"
                : previewCandidates.length > 0
                  ? "Local app detected"
                  : "No running app detected"}
            </strong>
            <p>
              DeskCue opens the app through the same secure connection as this dashboard.
              Your browser never connects directly to the workspace machine's localhost.
            </p>
          </div>
          {!previewCandidatesLoading && canManagePreview ? (
            <PreviewConnectionForm
              configuredPreviewPort={configuredPreviewPort}
              previewCandidates={previewCandidates}
              previewCandidatesError={previewCandidatesError}
              previewCandidatesLoading={previewCandidatesLoading}
              previewNetworkMode={configuredPreviewNetworkMode}
              previewPort={previewPort}
              submitLabel="Open preview"
              onChangePreviewPort={onChangePreviewPort}
              onChangePreviewNetworkMode={onChangePreviewNetworkMode}
              onSubmit={onSetPreview}
            />
          ) : !previewCandidatesLoading ? (
            <p>Configure Preview on the workspace machine, then refresh this session.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
