import { Tooltip } from "@components/Tooltip";

import styles from "./styles.module.scss";
import type { ActionDecisionPanelProps } from "./types";

export function ActionDecisionPanel({
  actionRequest,
  disabled,
  onApprove,
  onReject
}: ActionDecisionPanelProps) {
  const decisionText =
    actionRequest.reason ?? actionRequest.command ?? "Agent is waiting for your decision.";

  return (
    <div className={styles.actionDecisionPanel}>
      <div className={styles.actionDecisionText}>
        <strong>Approval needed</strong>
        <Tooltip
          anchor="parent"
          className={styles.actionDecisionReason}
          value={decisionText}
        />
      </div>
      <div className={styles.actionDecisionButtons}>
        <button className={styles.rejectButton} disabled={disabled} type="button" onClick={onReject}>
          Reject
        </button>
        <button className={styles.approveButton} disabled={disabled} type="button" onClick={onApprove}>
          Approve
        </button>
      </div>
    </div>
  );
}
