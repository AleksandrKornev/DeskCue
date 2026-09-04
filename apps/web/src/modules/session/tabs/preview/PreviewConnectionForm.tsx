import clsx from "clsx";
import { useEffect, useId, useState } from "react";
import type { SubmitEvent } from "react";

import type { PreviewCandidate, PreviewNetworkMode } from "@deskcue/protocol";
import { parsePreviewPort } from "@models/sessionPreview";
import styles from "@modules/session/tabs/styles.module.scss";

type Props = {
  compact?: boolean;
  configuredPreviewPort: number | null;
  previewCandidates: PreviewCandidate[];
  previewCandidatesError: string;
  previewCandidatesLoading: boolean;
  previewNetworkMode: PreviewNetworkMode;
  previewPort: string;
  submitLabel: string;
  onChangePreviewPort: (value: string) => void;
  onChangePreviewNetworkMode: (value: PreviewNetworkMode) => boolean | Promise<boolean>;
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
};

export function PreviewConnectionForm({
  compact = false,
  configuredPreviewPort,
  previewCandidates,
  previewCandidatesError,
  previewCandidatesLoading,
  previewNetworkMode,
  previewPort,
  submitLabel,
  onChangePreviewPort,
  onChangePreviewNetworkMode,
  onSubmit
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(previewCandidates.length === 0);
  const previewPortInputId = useId();
  const previewPortErrorId = `${previewPortInputId}-error`;
  const parsedPreviewPort = parsePreviewPort(previewPort);
  const previewPortError = previewPort.trim() && !parsedPreviewPort.ok
    ? "Preview port must be an integer between 1 and 65535"
    : "";

  useEffect(() => {
    setAdvancedOpen(previewCandidates.length === 0);
  }, [previewCandidates.length]);

  return (
    <form className={clsx(styles.previewConnectForm, compact && styles.previewConnectFormCompact)} onSubmit={onSubmit}>
      <div className={styles.previewConnectionFields}>
        {previewCandidates.length > 0 ? (
          <div aria-label="Detected local apps" className={styles.previewCandidates} role="group">
            {previewCandidates.map((candidate) => (
              <button
                aria-label={`Local app on port ${candidate.port}`}
                aria-pressed={previewPort === String(candidate.port)}
                className={clsx(
                  styles.previewCandidate,
                  previewPort === String(candidate.port) && styles.previewCandidateSelected
                )}
                key={candidate.port}
                onClick={() => onChangePreviewPort(String(candidate.port))}
                type="button"
              >
                <span>
                  {previewPort === String(candidate.port)
                    ? "Selected app"
                    : configuredPreviewPort === candidate.port
                      ? "Current preview"
                      : "Select detected app"}
                </span>
                <strong>Port {candidate.port}</strong>
              </button>
            ))}
          </div>
        ) : null}
        <details
          className={styles.previewAdvanced}
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>{previewCandidates.length > 0 ? "Use another port" : "Enter a local port"}</summary>
          <div className={styles.inlineForm}>
            <input
              aria-describedby={previewPortError ? previewPortErrorId : undefined}
              aria-invalid={Boolean(previewPortError)}
              aria-label="Preview port"
              className={styles.field}
              id={previewPortInputId}
              inputMode="numeric"
              name="previewPort"
              placeholder="5173"
              type="text"
              value={previewPort}
              onChange={(event) => onChangePreviewPort(event.target.value)}
            />
          </div>
          {previewPortError ? (
            <p
              className={styles.previewDiscoveryError}
              id={previewPortErrorId}
              role="alert"
            >
              {previewPortError}
            </p>
          ) : null}
        </details>
        <fieldset className={styles.previewNetworkModes}>
          <legend>External requests</legend>
          <label
            className={clsx(
              styles.previewNetworkMode,
              previewNetworkMode === "device-direct" && styles.previewNetworkModeSelected
            )}
          >
            <input
              checked={previewNetworkMode === "device-direct"}
              name="preview-network-mode"
              onChange={() => void onChangePreviewNetworkMode("device-direct")}
              type="radio"
            />
            <span>
              <strong>From this device</strong>
              <small>External requests use this browser or device.</small>
            </span>
          </label>
          <label
            className={clsx(
              styles.previewNetworkMode,
              previewNetworkMode === "deskcue-host" && styles.previewNetworkModeSelected
            )}
          >
            <input
              checked={previewNetworkMode === "deskcue-host"}
              name="preview-network-mode"
              onChange={() => void onChangePreviewNetworkMode("deskcue-host")}
              type="radio"
            />
            <span>
              <strong>Through DeskCue host</strong>
              <small>External requests use the host computer and its VPN.</small>
            </span>
          </label>
        </fieldset>
        {previewCandidatesError ? (
          <p className={styles.previewDiscoveryError} role="status">{previewCandidatesError}</p>
        ) : null}
      </div>
      <button
        className={styles.primaryButton}
        disabled={!previewPort.trim() || Boolean(previewPortError) || previewCandidatesLoading}
        type="submit"
      >
        {previewCandidatesLoading ? "Checking local apps…" : submitLabel}
      </button>
    </form>
  );
}
