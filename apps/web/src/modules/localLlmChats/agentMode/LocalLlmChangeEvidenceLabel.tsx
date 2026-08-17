import { changeEvidenceCopy } from "./helpers";
import styles from "./localLlmAgentMode.module.scss";
import type { LocalLlmChangeEvidenceLabelProps } from "./localLlmAgentMode.types";

export function LocalLlmChangeEvidenceLabel({ evidence }: LocalLlmChangeEvidenceLabelProps) {
  const copy = changeEvidenceCopy(evidence.kind, evidence.fileCount);

  return (
    <div className={`${styles.changeEvidence} ${styles[`change_${evidence.kind}`]}`}>
      <strong>{copy.title}</strong>
      <span>{evidence.description ?? copy.description}</span>
    </div>
  );
}
