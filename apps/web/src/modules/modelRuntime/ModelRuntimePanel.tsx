import { useId } from "react";

import { AgentChatBadge, isSubagentChat } from "@components/AgentChatBadge";
import { useBottomSheetDrag } from "@components/BottomSheet";
import {
  ModalCloseButton,
  useModalFocusLifecycle,
  useModalHistoryLifecycle
} from "@components/Modal";

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
  const historyId = useId();
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

  const { modalEntryId, onCloseRef } = useModalFocusLifecycle({ dialogRef: sheetRef, onClose });

  useModalHistoryLifecycle({
    enabled: true,
    historyId,
    modalEntryId,
    onCloseRef
  });

  return (
    <div className={styles.backdrop}>
      <button
        aria-hidden="true"
        aria-label="Close model and runtime context"
        className={styles.backdropDismiss}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-label="Model and runtime context"
        aria-modal="true"
        className={styles.panel}
        ref={sheetRef}
        role="dialog"
        {...sheetGestureProps}
        tabIndex={-1}
      >
        <div aria-hidden="true" className={styles.dragHandle} {...dragHandleProps} />
        <div className={styles.header} {...dragHandleProps}>
          <div className={styles.headerCopy}>
            <h3>Model & runtime</h3>
            <p>
              Read-only context for this chat. Model is shown only when local metadata exposes it
            </p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.headerMeta}>
              {isAgentChat ? <AgentChatBadge /> : null}
              <span className={styles.summaryPill}>{model.name ?? adapterDetails.label}</span>
            </div>
            <ModalCloseButton
              className={styles.headerClose}
              label="Close model and runtime context"
              onClick={onClose}
            />
          </div>
        </div>

        <dl aria-label="Model and runtime details" className={styles.grid} tabIndex={0}>
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
