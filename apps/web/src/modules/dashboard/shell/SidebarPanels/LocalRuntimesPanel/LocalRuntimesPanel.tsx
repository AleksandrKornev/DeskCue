import clsx from "clsx";

import { Tooltip } from "@components/Tooltip";
import { truncateRuntimeModel } from "@modules/dashboard/shell/SidebarPanels/helpers";
import { SidebarPanel } from "@modules/dashboard/shell/SidebarPanels/SidebarPanel";
import type { LocalRuntimesPanelProps } from "@modules/dashboard/shell/SidebarPanels/types";

import styles from "./styles.module.scss";

export function LocalRuntimesPanel({
  compact,
  emptyText = "No local runtimes detected yet",
  hideLabel = "Hide runtimes",
  isBootstrapping,
  isOpen,
  isTriggerHidden = false,
  runtimes,
  showLabel = "Show runtimes",
  showStatusIndicator = true,
  subtitle = "Diagnostics for local engines on this machine",
  title = "Local runtimes",
  isStartingLmStudio = false,
  lmStudioControlMessage = null,
  onOpenChat,
  onStartLmStudio,
  onToggleOpen
}: LocalRuntimesPanelProps) {
  return (
    <SidebarPanel
      compact={compact}
      title={title}
      subtitle={subtitle}
    >
      <div className={styles.stack}>
        {isTriggerHidden ? null : (
          <button
            className={clsx(styles.button, styles.ghostButton, styles.smallButton)}
            onClick={onToggleOpen}
            type="button"
          >
            {isOpen ? hideLabel : `${showLabel} (${runtimes.length})`}
          </button>
        )}

        {isOpen ? (
          isBootstrapping ? (
            <>
              <div className={clsx(styles.runtimeCard, styles.skeletonBlock)} aria-hidden="true" />
              <div className={clsx(styles.runtimeCard, styles.skeletonBlock)} aria-hidden="true" />
            </>
          ) : runtimes.length === 0 ? (
            <p className={styles.muted}>{emptyText}</p>
          ) : (
            <div className={styles.runtimeList}>
              {runtimes.map((runtime) => (
                <div key={runtime.id} className={styles.runtimeRow}>
                  <div className={styles.runtimeRowHeader}>
                    <div className={styles.runtimeRowTitle}>
                      <strong>{runtime.label}</strong>
                      {showStatusIndicator ? (
                        <span
                          aria-hidden="true"
                          className={clsx(
                            styles.runtimeDot,
                            runtime.running
                              ? styles.runtimeDotOnline
                              : runtime.installed
                                ? styles.runtimeDotInstalled
                                : styles.runtimeDotUnavailable
                          )}
                        />
                      ) : null}
                    </div>
                    <div className={styles.runtimeActions}>
                      <span className={styles.runtimeStatus}>{runtime.statusText}</span>
                      {onOpenChat && runtime.running && (runtime.id === "ollama" || runtime.id === "lm-studio") ? (
                        <button
                          className={styles.chatButton}
                          onClick={() => onOpenChat(runtime)}
                          type="button"
                        >
                          Open chat
                        </button>
                      ) : null}
                      {runtime.id === "lm-studio" && runtime.installed && !runtime.running && onStartLmStudio ? (
                        <button
                          className={styles.chatButton}
                          disabled={isStartingLmStudio}
                          onClick={onStartLmStudio}
                          type="button"
                        >
                          {isStartingLmStudio ? "Starting…" : "Start Local Server"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {runtime.lastActiveModel ? (
                    <span className={styles.runtimeMeta}>
                      <Tooltip
                        className={styles.runtimeMetaTooltip}
                        placement="above"
                        value={`Last active: ${runtime.lastActiveModel}`}
                      >
                        Last active: {truncateRuntimeModel(runtime.lastActiveModel)}
                      </Tooltip>
                    </span>
                  ) : null}
                  {runtime.modelStoragePath && runtime.id === "ollama" && runtime.modelCount === 0 ? (
                    <span className={clsx(styles.runtimeMeta, styles.runtimeMetaWrap)}>
                      No models reported by this endpoint. Storage: {runtime.modelStoragePath}
                    </span>
                  ) : null}
                  {runtime.id === "lm-studio" && lmStudioControlMessage ? (
                    <span className={clsx(styles.runtimeMeta, styles.runtimeMetaWrap)}>
                      {lmStudioControlMessage}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </SidebarPanel>
  );
}
