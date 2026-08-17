import clsx from "clsx";
import { useLayoutEffect, useRef, useState } from "react";

import { getDeskCueRuntime } from "@runtime";

import { PreviewConnectionForm, PreviewToolbarIcon } from "./preview";
import { resolvePreviewFrameUrl } from "./preview/previewUrlIdentity";
import styles from "./styles.module.scss";
import type { PreviewTabPanelProps } from "./types";

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

  return normalizedHostname === "localhost" ||
    normalizedHostname.endsWith(".localhost") ||
    normalizedHostname === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalizedHostname);
}

function usesInsecureNetworkOrigin(previewUrl: string | null) {
  if (!previewUrl) return false;

  try {
    const resolvedPreviewUrl = new URL(previewUrl, window.location.href);

    return resolvedPreviewUrl.protocol === "http:" &&
      !isLoopbackHostname(resolvedPreviewUrl.hostname);
  } catch {
    return false;
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
  const [loadedFrameKey, setLoadedFrameKey] = useState("");
  const [launchError, setLaunchError] = useState("");
  const [launchingPreview, setLaunchingPreview] = useState(false);
  const [stoppingPreview, setStoppingPreview] = useState(false);
  const [storedFrameUrl, setStoredFrameUrl] = useState<string | null>(previewUrl);
  const frameUrl = resolvePreviewFrameUrl(storedFrameUrl, previewUrl);
  const frameKey = `${frameUrl ?? ""}:${previewDocumentRevision}:${previewReloadVersion}`;
  const frameKeyRef = useRef(frameKey);
  const frameReady = Boolean(frameUrl) && loadedFrameKey === frameKey;
  const hasLimitedBrowserFeatures = usesInsecureNetworkOrigin(frameUrl ?? previewUrl);
  const isHostLaunchedPreview = isPreviewActive && onLaunchPreview !== undefined;
  const hasPreviewSurface = Boolean(previewUrl) || isHostLaunchedPreview;
  const previewStatus = isPreviewActive && previewLoading
    ? "Checking preview…"
    : activePreviewError
      ? "Preview unavailable"
      : previewUrl && configuredPreviewPort
        ? frameReady ? `Live · port ${configuredPreviewPort}` : `Loading · port ${configuredPreviewPort}`
        : isPreviewActive
          ? `Configured on port ${configuredPreviewPort}`
          : "Preview is off";
  const compactPreviewStatus = activePreviewError
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

  return (
    <div
      className={clsx(
        styles.previewReview,
        hasPreviewSurface && connectionOpen && styles.previewReviewConnectionOpen
      )}
    >
      <div className={styles.previewReviewToolbar}>
        <div className={styles.previewStatusGroup}>
          <div aria-label={previewStatus} className={styles.previewReviewStatus} role="status">
            <span
              aria-hidden="true"
              className={clsx(styles.previewStatusDot, previewUrl && frameReady && styles.previewStatusDotLive)}
            />
            <span className={styles.previewStatusLong}>{previewStatus}</span>
            <span className={styles.previewStatusCompact}>{compactPreviewStatus}</span>
          </div>
          {hasPreviewSurface && canManagePreview ? (
            <button
              aria-label="Stop preview"
              className={clsx(styles.previewToolbarButton, styles.previewToolbarButtonStop)}
              disabled={stoppingPreview}
              onClick={() => {
                setStoppingPreview(true);
                void Promise.resolve(onStopPreview()).finally(() => setStoppingPreview(false));
              }}
              title="Stop DeskCue preview without stopping the local app"
              type="button"
            >
              <PreviewToolbarIcon kind="stop" />
              <span className={styles.previewToolbarText}>{stoppingPreview ? "Stopping…" : "Stop"}</span>
            </button>
          ) : null}
        </div>

        {hasPreviewSurface ? (
          <div className={styles.previewToolbarActions}>
            {previewUrl ? (
              <button
                aria-label="Reload"
                className={styles.previewToolbarButton}
                onClick={onReloadPreview}
                type="button"
              >
                <PreviewToolbarIcon kind="reload" />
                <span className={styles.previewToolbarText}>Reload</span>
              </button>
            ) : null}
            {canManagePreview ? <button
              aria-label="Preview connection"
              aria-expanded={connectionOpen}
              className={styles.previewToolbarButton}
              onClick={() => setConnectionOpen((value) => !value)}
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

      {hasPreviewSurface && canManagePreview && connectionOpen ? (
        <div className={styles.previewConnectionPanel}>
          <div>
            <strong>Preview connection</strong>
            <p>The local app always stays behind DeskCue. Choose where its external requests should run, or switch the local port.</p>
          </div>
          <PreviewConnectionForm
            compact
            previewCandidates={previewCandidates}
            previewCandidatesError={previewCandidatesError}
            previewCandidatesLoading={previewCandidatesLoading}
            previewNetworkMode={configuredPreviewNetworkMode}
            previewPort={previewPort}
            submitLabel="Switch preview"
            onChangePreviewPort={onChangePreviewPort}
            onChangePreviewNetworkMode={onChangePreviewNetworkMode}
            onSubmit={(event) => {
              onSetPreview(event);
              setConnectionOpen(false);
            }}
          />
        </div>
      ) : null}

      {!hasSelectedSession || (isPreviewActive && previewLoading) ? (
        <div
          aria-label="Opening preview"
          className={clsx(styles.skeletonBlock, styles.previewLoading)}
          role="status"
        />
      ) : activePreviewError ? (
        <div className={styles.previewEmptyState}>
          <div role="alert">
            <strong>Preview could not connect</strong>
            <p>{activePreviewError} Start the configured app and retry, or switch to another local app.</p>
          </div>
          <div className={styles.previewRecoveryActions}>
            <button className={styles.smallGhostButton} onClick={onRetryPreview} type="button">
              Retry current port
            </button>
            {canManagePreview ? (
              <PreviewConnectionForm
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
                className={clsx(styles.previewShellFrame, frameReady && styles.previewShellFrameReady)}
                onLoad={() => {
                  if (frameKeyRef.current === frameKey) setLoadedFrameKey(frameKey);
                }}
                sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
                src={frameUrl ?? previewUrl}
                title="DeskCue preview"
              />
              {!frameReady ? <div aria-label="Loading preview page" className={styles.previewFrameLoading} role="status" /> : null}
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
