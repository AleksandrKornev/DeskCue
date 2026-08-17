import { statusCopy } from "./helpers";
import styles from "./localLlmAgentMode.module.scss";
import type { LocalLlmActionRequestCardProps } from "./localLlmAgentMode.types";

export function LocalLlmActionRequestCard({
  disabled = false,
  request,
  onApprove,
  onReject
}: LocalLlmActionRequestCardProps) {
  const isPending = request.status === "pending";
  const statusLabel = statusCopy(request.status);

  return (
    <section className={styles.actionCard} aria-label={`Action request: ${request.title}`}>
      <div className={styles.actionCardHeading}>
        <span className={styles.actionEyebrow}>{isPending ? "Approval needed" : statusLabel}</span>
        <strong>{request.title}</strong>
      </div>
      <p>{request.description}</p>
      {request.scope ? <p className={styles.actionScope}>{request.scope}</p> : null}
      {isPending ? (
        <div className={styles.actionButtons}>
          <button disabled={disabled} onClick={() => onReject(request.id)} type="button">Reject</button>
          <button
            className={styles.approveButton}
            disabled={disabled}
            onClick={() => onApprove(request.id)}
            type="button"
          >
            {request.actionLabel || "Approve"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
