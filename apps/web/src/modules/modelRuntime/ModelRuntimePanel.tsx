import { useEffect } from "react";

import { AgentChatBadge, isSubagentChat } from "@components/AgentChatBadge";
import { useBottomSheetDrag } from "@components/BottomSheet";

import {
  buildModelRuntimeDetailItems,
  formatValue,
  getAdapterDetails,
  getMode,
  getModelInfo
} from "./helpers";
import styles from "./styles.module.scss";
import type { ModelRuntimePanelProps } from "./types";

export function ModelRuntimePanel({ agentSession, onClose, session }: ModelRuntimePanelProps) {
  const {
    dragHandleProps,
    sheetGestureProps,
    sheetRef
  } = useBottomSheetDrag<HTMLElement>({ onDismiss: onClose });
  const adapterId = session?.adapterId ?? agentSession?.agentId ?? "generic-cli";
  const adapterDetails = getAdapterDetails(adapterId, agentSession?.agentLabel);
  const model = getModelInfo(agentSession, session);
  const mode = getMode(agentSession, session);
  const isAgentChat = isSubagentChat(agentSession);
  const detailItems = buildModelRuntimeDetailItems({
    adapterDetails,
    agentSession,
    mode,
    model,
    session
  });

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className={styles.backdrop}>
      <button
        aria-label="Close model and runtime context"
        className={styles.backdropDismiss}
        onClick={onClose}
        type="button"
      />
      <section
        aria-label="Model and runtime context"
        aria-modal="true"
        className={styles.panel}
        ref={sheetRef}
        role="dialog"
        {...sheetGestureProps}
      >
        <div aria-hidden="true" className={styles.dragHandle} {...dragHandleProps} />
        <div className={styles.header} {...dragHandleProps}>
          <div>
            <h3>Model & runtime</h3>
            <p>
              Read-only context for this chat. Model is shown only when local metadata exposes it
            </p>
          </div>
          <div className={styles.headerActions}>
            {isAgentChat ? <AgentChatBadge /> : null}
            <span className={styles.summaryPill}>{model.name ?? adapterDetails.label}</span>
            <button
              aria-label="Close model and runtime context"
              className={styles.closeButton}
              onClick={onClose}
              title="Close"
              type="button"
            >
              ×
            </button>
          </div>
        </div>

        <dl className={styles.grid}>
          {detailItems.map((item) => (
            <div className={styles.item} key={item.label}>
              <dt>{item.label}</dt>
              <dd>{formatValue(item.value)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
