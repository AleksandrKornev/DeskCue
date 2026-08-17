import { MODE_COPY } from "./constants";
import styles from "./localLlmAgentMode.module.scss";
import type { LocalLlmAgentModePanelProps } from "./localLlmAgentMode.types";

export function LocalLlmAgentModePanel({
  capabilities,
  compact = false
}: LocalLlmAgentModePanelProps) {
  const copy = MODE_COPY[capabilities.mode];
  const workspaceLabel = capabilities.workspaceName ?? "No workspace linked";

  if (compact) {
    return (
      <span
        aria-label={`Agent mode: ${copy.label}`}
        className={`${styles.modePill} ${styles[`mode_${capabilities.mode}`]}`}
        title={copy.detail}
      >
        {copy.label}
      </span>
    );
  }

  return (
    <section className={styles.modePanel} aria-label="Local agent mode">
      <div className={styles.modeHeading}>
        <span className={`${styles.modePill} ${styles[`mode_${capabilities.mode}`]}`}>{copy.label}</span>
        <strong>Local agent mode</strong>
      </div>
      <p>{copy.detail}</p>
      <dl className={styles.modeFacts}>
        <div>
          <dt>Workspace</dt>
          <dd title={workspaceLabel}>{workspaceLabel}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{capabilities.toolsEnabled ? "Available" : "Not available"}</dd>
        </div>
        <div>
          <dt>Changes</dt>
          <dd>{capabilities.changesEnabled ? "Recorded here" : "Not available"}</dd>
        </div>
      </dl>
    </section>
  );
}
