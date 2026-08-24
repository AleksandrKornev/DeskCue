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
            <p className={styles.command}>
              <Tooltip
                className={styles.commandTooltip}
                placement="below"
                tapToOpen
                value={title}
              />
            </p>
            <StatusBadge
              className={clsx(
                styles.headerStatusBadge,
                status === "running" && styles.headerStatusBadgeRunning,
                statusLabel && styles.headerStatusBadgeActionable
              )}
              label={statusLabel}
              status={status}
            />
          </div>
          <div className={styles.metaRow}>
            {isAgentChat ? <AgentChatBadge /> : null}
            <span className={clsx(styles.sourcePill, styles.sourcePillMuted)}>
              {agentLabel ?? adapterLabel}
            </span>
            {metaItem ? (
              <span className={styles.desktopMetaItem}>{metaItem}</span>
            ) : null}
            {contextCompactionCount > 0 ? (
              <span
                aria-label={`Earlier context was compacted ${contextCompactionCount} time${contextCompactionCount === 1 ? "" : "s"} in this native session.`}
                className={clsx(
                  styles.sourcePill,
                  styles.sourcePillMuted,
                  styles.contextCompactionPill
                )}
                title={`Earlier context was compacted ${contextCompactionCount} time${contextCompactionCount === 1 ? "" : "s"} in this native session.`}
              >
                <span aria-hidden="true" className={styles.desktopCompactionLabel}>
                  Compacted <span className={styles.sourcePillMultiplier}>x</span>
                  {contextCompactionCount}
                </span>
                <span aria-hidden="true" className={styles.mobileCompactionLabel}>
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
