import clsx from "clsx";
import { useCallback, useLayoutEffect, useState } from "react";

import BackIcon from "@assets/images/icon-arrow-left.svg?react";
import ChevronDownIcon from "@assets/images/icon-chevron-down.svg?react";
import CompactionIcon from "@assets/images/icon-reload.svg?react";
import SubagentIcon from "@assets/images/icon-tool-agents.svg?react";
import { AgentChatBadge } from "@components/AgentChatBadge";
import { AgentRuntimeIcon } from "@components/AgentRuntimeIcon";
import { Modal } from "@components/Modal";
import { StatusBadge } from "@components/Panel";
import { SegmentedTabs } from "@components/SegmentedTabs";
import { Tooltip } from "@components/Tooltip";
import {
  getSessionTabLabel,
  getSessionTabsForCapabilities
} from "@models/sessionTabs";

import {
  getWorkspaceDisplayLabel,
  isAttentionSessionStatus,
  isDangerSessionStatus
} from "./helpers";
import {
  LiveConnectionAnnouncement,
  LiveConnectionIndicator
} from "./LiveConnectionIndicator";
import styles from "./styles.module.scss";
import type { LiveSessionHeaderProps } from "./types";
import { useMobileSessionHeaderCollapse } from "./useMobileSessionHeaderCollapse";

function getSessionStatusAnnouncement(
  status: LiveSessionHeaderProps["status"],
  statusLabel?: string
) {
  const label = statusLabel ?? (status === "read_only" ? "read only" : status);

  return `Session status: ${label}`;
}

function isElementOverflowing(element: HTMLElement) {
  return element.scrollHeight - element.clientHeight > 1 || element.scrollWidth - element.clientWidth > 1;
}

function getContextCompactionPresentation(count: number) {
  const occurrenceLabel = `Earlier context was compacted ${count} time${count === 1 ? "" : "s"} in this native session`;
  const ariaLabel = `Context compacted ${count} time${count === 1 ? "" : "s"}`;

  if (count <= 1) {
    return {
      ariaLabel,
      className: styles.contextCompactionLow,
      tooltipLabel: `${occurrenceLabel}. Compaction level is low`
    };
  }

  if (count <= 5) {
    return {
      ariaLabel,
      className: styles.contextCompactionElevated,
      tooltipLabel: `${occurrenceLabel}. Compaction level is elevated; consider starting a new chat if context quality drops`
    };
  }

  return {
    ariaLabel,
    className: styles.contextCompactionHigh,
    tooltipLabel: `${occurrenceLabel}. Compaction level is high; consider starting a new chat soon`
  };
}

function getRuntimeIconId(sourceLabel: string) {
  return sourceLabel.trim().replaceAll(/\s+/gu, "-");
}

function isPositiveSessionStatus(
  status: LiveSessionHeaderProps["status"],
  statusLabel?: string
) {
  return status === "running" || statusLabel?.trim().toLowerCase() === "ready";
}

function useTitleOverflow(title: string) {
  const [titleElement, setTitleElement] = useState<HTMLSpanElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const titleRef = useCallback((element: HTMLSpanElement | null) => setTitleElement(element), []);

  const measureOverflow = useCallback(() => {
    if (!titleElement) return;

    setIsOverflowing(isElementOverflowing(titleElement));
  }, [titleElement]);

  useLayoutEffect(() => {
    if (!titleElement) return;

    measureOverflow();
    window.addEventListener("resize", measureOverflow);

    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", measureOverflow);
    }

    const resizeObserver = new ResizeObserver(measureOverflow);

    resizeObserver.observe(titleElement);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureOverflow);
    };
  }, [measureOverflow, title, titleElement]);

  return { isOverflowing, titleRef };
}

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
  const { isOverflowing: isTitleOverflowing, titleRef } = useTitleOverflow(title);
  const [isTitleDisclosureFocused, setIsTitleDisclosureFocused] = useState(false);
  const [isMobileContextOpen, setIsMobileContextOpen] = useState(false);
  const showTitleDisclosure = isTitleOverflowing || isTitleDisclosureFocused;
  const sessionStatusAnnouncement = getSessionStatusAnnouncement(status, statusLabel);
  const contextCompaction = contextCompactionCount > 0
    ? getContextCompactionPresentation(contextCompactionCount)
    : null;
  const resolvedSourceLabel = agentLabel ?? adapterLabel;
  const resolvedStatusLabel = statusLabel ?? (status === "read_only" ? "read only" : status);
  const hasDangerStatus = isDangerSessionStatus(status, statusLabel);
  const hasAttentionStatus = !hasDangerStatus && isAttentionSessionStatus(statusLabel);
  const hasPositiveStatus = !hasDangerStatus &&
    !hasAttentionStatus &&
    isPositiveSessionStatus(status, statusLabel);
  const runtimeTooltipLabel = `This chat uses the ${resolvedSourceLabel} runtime`;
  const runtimeIconId = getRuntimeIconId(resolvedSourceLabel);
  const workspaceDisplayLabel = getWorkspaceDisplayLabel(subtitle);
  const mobileContextAriaLabel = `${isAgentChat ? "Subagent session. " : ""}Runtime: ${resolvedSourceLabel}. Workspace: ${workspaceDisplayLabel}. Show full session context`;

  return (
    <div
      className={clsx(
        styles.chatToolbarShell,
        isMobileCollapsed && styles.chatToolbarCollapsed
      )}
      ref={toolbarRef}
    >
      <div className={styles.chatHeader}>
        <button
          aria-label="Back to chats"
          className={styles.mobileBackButton}
          onClick={onExitSession}
          type="button"
        >
          <BackIcon
            aria-hidden="true"
            className={styles.mobileBackIcon}
            focusable="false"
          />
        </button>
        <div className={styles.chatMain}>
          <div className={styles.titleRow}>
            <h1
              className={styles.command}
              onBlur={() => setIsTitleDisclosureFocused(false)}
              onFocus={() => setIsTitleDisclosureFocused(true)}
            >
              {showTitleDisclosure ? (
                <Tooltip
                  ariaLabel={`Session title: ${title}`}
                  className={styles.commandTooltip}
                  placement="below"
                  tapToOpen
                  value={title}
                >
                  <span className={styles.commandText} ref={titleRef}>{title}</span>
                </Tooltip>
              ) : (
                <span className={styles.commandText} ref={titleRef}>{title}</span>
              )}
            </h1>
          </div>
          {actions}
          <div
            aria-hidden={isMobileCollapsed}
            className={styles.metaRow}
            data-collapsible-session-meta
            inert={isMobileCollapsed}
          >
            <span className={styles.sessionMetaCluster}>
              <span className={styles.headerStatus}>
                <Tooltip
                  ariaLabel={`Session status: ${resolvedStatusLabel}`}
                  className={styles.headerStatusDisclosure}
                  placement="below"
                  tapToOpen
                  value={resolvedStatusLabel}
                >
                  <StatusBadge
                    className={clsx(
                      styles.headerStatusBadge,
                      hasPositiveStatus && styles.headerStatusBadgePositive,
                      hasAttentionStatus && styles.headerStatusBadgeActionable,
                      hasDangerStatus && styles.headerStatusBadgeDanger
                    )}
                    label={statusLabel}
                    status={status}
                  />
                </Tooltip>
              </span>
              {contextCompaction ? (
                <span className={styles.compactionSlot}>
                  <Tooltip
                    ariaLabel={contextCompaction.ariaLabel}
                    className={clsx(
                      styles.sourcePill,
                      styles.sourcePillMuted,
                      styles.contextCompactionPill,
                      contextCompaction.className
                    )}
                    fitContent
                    placement="below"
                    tapToOpen
                    value={contextCompaction.tooltipLabel}
                  >
                    <span aria-hidden="true" className={styles.desktopCompactionLabel}>
                      Compacted <span className={styles.sourcePillMultiplier}>x</span>
                      {contextCompactionCount}
                    </span>
                    <span aria-hidden="true" className={styles.mobileCompactionLabel}>
                      <CompactionIcon className={styles.mobileCompactionIcon} focusable="false" />
                      {contextCompactionCount}
                    </span>
                  </Tooltip>
                </span>
              ) : null}
              {isAgentChat ? (
                <span className={styles.desktopAgentChatBadgeSlot}>
                  <AgentChatBadge />
                </span>
              ) : null}
              <span
                className={clsx(
                  styles.sourcePill,
                  styles.sourcePillMuted,
                  styles.desktopSourcePill,
                  styles.runtimePill
                )}
                title={runtimeTooltipLabel}
              >
                <AgentRuntimeIcon className={styles.runtimePillIcon} runtimeId={runtimeIconId} />
                {resolvedSourceLabel}
              </span>
              {metaItem ? (
                <span className={styles.desktopMetaItem}>{metaItem}</span>
              ) : null}
              <span className={styles.mobileSessionContextSlot}>
                <button
                  aria-expanded={isMobileContextOpen}
                  aria-haspopup="dialog"
                  aria-label={mobileContextAriaLabel}
                  className={styles.mobileSessionContext}
                  onClick={() => setIsMobileContextOpen(true)}
                  type="button"
                >
                  <span className={styles.mobileContextIconStack}>
                    <AgentRuntimeIcon
                      className={styles.mobileAgentSourceIcon}
                      runtimeId={runtimeIconId}
                    />
                    {isAgentChat ? (
                      <SubagentIcon
                        aria-hidden="true"
                        className={styles.mobileSubagentIcon}
                        focusable="false"
                      />
                    ) : null}
                  </span>
                  <span className={styles.mobileAgentSourceLabel}>{resolvedSourceLabel}</span>
                  <span aria-hidden="true" className={styles.mobileContextSeparator}>·</span>
                  <span className={styles.mobileContextWorkspaceLabel}>{workspaceDisplayLabel}</span>
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={styles.mobileContextChevron}
                    focusable="false"
                  />
                </button>
              </span>
            </span>
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
      </div>

      <Modal
        closeLabel="Close session context"
        closeOnHistoryBack
        description="Runtime and workspace used by this chat"
        isOpen={isMobileContextOpen}
        title="Session context"
        onClose={() => setIsMobileContextOpen(false)}
      >
        <dl className={styles.mobileSessionContextDetails}>
          {isAgentChat ? (
            <div>
              <dt>Session</dt>
              <dd><AgentChatBadge /></dd>
            </div>
          ) : null}
          <div>
            <dt>Runtime</dt>
            <dd>{resolvedSourceLabel}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd>{workspaceDisplayLabel}</dd>
          </div>
          <div>
            <dt>Workspace path</dt>
            <dd>{subtitle}</dd>
          </div>
        </dl>
      </Modal>

      <LiveConnectionAnnouncement connection={liveUpdatesConnection} />
      <span aria-atomic="true" aria-live="polite" className={styles.srOnly} role="status">
        {sessionStatusAnnouncement}
      </span>

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
