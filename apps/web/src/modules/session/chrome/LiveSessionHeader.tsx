import clsx from "clsx";

import CompactionIcon from "@assets/images/icon-reload.svg?react";
import { AgentChatBadge } from "@components/AgentChatBadge";
import { StatusBadge } from "@components/Panel";
import { SegmentedTabs } from "@components/SegmentedTabs";
import { Tooltip } from "@components/Tooltip";
import {
  getSessionTabLabel,
  getSessionTabsForCapabilities
} from "@models/sessionTabs";

import {
  isAttentionSessionStatus,
  isDangerSessionStatus
} from "./helpers";
import { LiveConnectionIndicator } from "./LiveConnectionIndicator";
import styles from "./styles.module.scss";
import type { LiveSessionHeaderProps } from "./types";
import { useMobileSessionHeaderCollapse } from "./useMobileSessionHeaderCollapse";

export function LiveSessionHeader({
  activeTab,
  actions,
  adapterLabel,
  agentLabel,
  isAgentChat,
  metaItem,
  contextCompactionCount,
  liveUpdatesConnection,
  navigationIdPrefix,
  status,
  statusLabel,
  subtitle,
  navigationCapabilities,
  title,
  toolbarRef,
  onExitSession,
  onSelectTab,
}: LiveSessionHeaderProps) {
  const isMobileCollapsed = useMobileSessionHeaderCollapse({ activeTab, toolbarRef });
  const contextCompactionLabel =
    contextCompactionCount > 0
      ? `Earlier context was compacted ${contextCompactionCount} time${contextCompactionCount === 1 ? "" : "s"} in this native session.`
      : null;

  return (
    <div
      className={clsx(
        styles.chatToolbarShell,
        isMobileCollapsed && styles.chatToolbarCollapsed
      )}
      ref={toolbarRef}
    >
      <div
        aria-hidden={isMobileCollapsed}
        className={styles.chatHeader}
      >
        <button
          aria-label="Back to chats"
          className={styles.mobileBackButton}
          onClick={onExitSession}
          type="button"
        >
          <span aria-hidden="true">←</span>
        </button>
        <div className={styles.chatMain}>
          <div className={styles.titleRow}>
            <h1 className={styles.command}>
              <Tooltip
                className={styles.commandTooltip}
                placement="below"
                tapToOpen
                value={title}
              />
            </h1>
          </div>
          <div className={styles.metaRow}>
            <span
              aria-atomic="true"
              aria-live="polite"
              className={styles.headerStatus}
              role="status"
            >
              <StatusBadge
                className={clsx(
                  styles.headerStatusBadge,
                  status === "running" && styles.headerStatusBadgeRunning,
                  isAttentionSessionStatus(statusLabel) && styles.headerStatusBadgeActionable,
                  isDangerSessionStatus(status, statusLabel) && styles.headerStatusBadgeDanger
                )}
                label={statusLabel}
                status={status}
              />
            </span>
            {isAgentChat ? <AgentChatBadge /> : null}
            <span className={clsx(styles.sourcePill, styles.sourcePillMuted)}>
              {agentLabel ?? adapterLabel}
            </span>
            {metaItem ? (
              <span className={styles.desktopMetaItem}>{metaItem}</span>
            ) : null}
            {contextCompactionLabel ? (
              <span
                className={clsx(
                  styles.sourcePill,
                  styles.sourcePillMuted,
                  styles.contextCompactionPill
                )}
              >
                <span className={styles.srOnly}>{contextCompactionLabel}</span>
                <span aria-hidden="true" className={styles.desktopCompactionLabel} title={contextCompactionLabel}>
                  Compacted <span className={styles.sourcePillMultiplier}>x</span>
                  {contextCompactionCount}
                </span>
                <span aria-hidden="true" className={styles.mobileCompactionLabel} title={contextCompactionLabel}>
                  <CompactionIcon className={styles.mobileCompactionIcon} focusable="false" />
                  {contextCompactionCount}
                </span>
              </span>
            ) : null}
            <LiveConnectionIndicator connection={liveUpdatesConnection} />
          </div>
          <p className={styles.path}>
            <Tooltip
              className={styles.pathTooltip}
              placement="below"
              tapToOpen
              value={subtitle}
            />
          </p>
        </div>
        {actions}
      </div>

      <SegmentedTabs
        activeTab={activeTab}
        ariaLabel="Session sections"
        className={styles.liveNav}
        idPrefix={navigationIdPrefix}
        mobileLayout="fill"
        options={getSessionTabsForCapabilities(navigationCapabilities).map((tab) => ({
          key: tab.key,
          label: getSessionTabLabel(tab, navigationCapabilities)
        }))}
        onSelectTab={onSelectTab}
      />
    </div>
  );
}
