import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

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

const MOBILE_HEADER_COLLAPSE_DISTANCE_PX = 18;
const MOBILE_HEADER_BOTTOM_REVEAL_DISTANCE_PX = 24;
const MOBILE_HEADER_BOTTOM_KEEP_EXPANDED_DISTANCE_PX = 120;
const MOBILE_HEADER_EXPAND_DISTANCE_PX = 12;

type MobileScrollDirection = "down" | "up";

function findVerticalScrollTarget(target: EventTarget | null, sessionSurface: HTMLElement) {
  let element = target instanceof HTMLElement ? target : null;
  const fallback = element;

  while (element && element !== sessionSurface) {
    const overflowY = window.getComputedStyle(element).overflowY;
    if (
      element.scrollHeight > element.clientHeight &&
      /^(auto|overlay|scroll)$/.test(overflowY)
    ) {
      return element;
    }

    element = element.parentElement;
  }

  return fallback;
}

function readDistanceFromScrollBottom(scrollTarget: HTMLElement) {
  if (scrollTarget.scrollHeight <= scrollTarget.clientHeight) return null;

  return Math.max(
    0,
    scrollTarget.scrollHeight - scrollTarget.clientHeight - scrollTarget.scrollTop
  );
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
  onSelectTab,
}: LiveSessionHeaderProps) {
  const [isMobileCollapsed, setIsMobileCollapsed] = useState(false);
  const activeTabRef = useRef(activeTab);
  const isMobileCollapsedRef = useRef(false);
  activeTabRef.current = activeTab;

  useEffect(() => {
    const compactViewport = window.matchMedia?.("(max-width: 520px)");
    if (!compactViewport?.matches) return;

    let activeScrollTarget: HTMLElement | null = null;
    let accumulatedDistance = 0;
    let intentDirection: MobileScrollDirection | null = null;
    let lastScrollTop = 0;
    let lastTouchY: number | null = null;
    const updateMobileCollapsed = (nextCollapsed: boolean) => {
      isMobileCollapsedRef.current = nextCollapsed;
      setIsMobileCollapsed(nextCollapsed);
    };
    const readScrollTarget = (event: Event) => {
      const sessionSurface = toolbarRef.current?.parentElement;
      if (!(event.target instanceof Node) || !sessionSurface?.contains(event.target)) return null;

      return findVerticalScrollTarget(event.target, sessionSurface);
    };
    const setScrollIntent = (
      scrollTarget: HTMLElement | null,
      nextDirection: MobileScrollDirection | null
    ) => {
      if (!scrollTarget) return;

      if (scrollTarget !== activeScrollTarget || nextDirection !== intentDirection) accumulatedDistance = 0;

      activeScrollTarget = scrollTarget;
      intentDirection = nextDirection;
      lastScrollTop = scrollTarget.scrollTop;
    };
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;

      setScrollIntent(
        readScrollTarget(event),
        event.deltaY > 0 ? "down" : "up"
      );
    };
    const handleTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null;
      setScrollIntent(readScrollTarget(event), null);
    };
    const handleTouchMove = (event: TouchEvent) => {
      const currentTouchY = event.touches[0]?.clientY ?? null;
      if (lastTouchY === null || currentTouchY === null || currentTouchY === lastTouchY) return;

      setScrollIntent(
        readScrollTarget(event),
        currentTouchY < lastTouchY ? "down" : "up"
      );
      lastTouchY = currentTouchY;
    };
    const handleScroll = (event: Event) => {
      const scrollTarget = event.target;
      const sessionSurface = toolbarRef.current?.parentElement;
      if (!(scrollTarget instanceof HTMLElement) || !sessionSurface?.contains(scrollTarget)) return;

      const distanceFromBottom = activeTabRef.current === "overview"
        ? readDistanceFromScrollBottom(scrollTarget)
        : null;
      const isInBottomExpansionZone = distanceFromBottom !== null && (
        isMobileCollapsedRef.current
          ? distanceFromBottom <= MOBILE_HEADER_BOTTOM_REVEAL_DISTANCE_PX
          : distanceFromBottom <= MOBILE_HEADER_BOTTOM_KEEP_EXPANDED_DISTANCE_PX
      );

      if (isInBottomExpansionZone) {
        updateMobileCollapsed(false);
        activeScrollTarget = scrollTarget;
        accumulatedDistance = 0;
        intentDirection = null;
        lastScrollTop = scrollTarget.scrollTop;
        return;
      }

      if (activeScrollTarget !== scrollTarget) {
        lastScrollTop = scrollTarget.scrollTop;
        return;
      }

      const delta = scrollTarget.scrollTop - lastScrollTop;
      lastScrollTop = scrollTarget.scrollTop;
      if (delta === 0 || !intentDirection) return;

      const scrollDirection = delta > 0 ? "down" : "up";
      if (scrollDirection !== intentDirection) return;

      accumulatedDistance += Math.abs(delta);

      if (
        intentDirection === "down" &&
        scrollTarget.scrollTop > MOBILE_HEADER_COLLAPSE_DISTANCE_PX &&
        accumulatedDistance >= MOBILE_HEADER_COLLAPSE_DISTANCE_PX
      ) {
        updateMobileCollapsed(true);
        accumulatedDistance = 0;
        intentDirection = null;
      } else if (
        intentDirection === "up" &&
        accumulatedDistance >= MOBILE_HEADER_EXPAND_DISTANCE_PX
      ) {
        updateMobileCollapsed(false);
        accumulatedDistance = 0;
        intentDirection = null;
      }
    };

    document.addEventListener("touchstart", handleTouchStart, true);
    document.addEventListener("touchmove", handleTouchMove, true);
    document.addEventListener("wheel", handleWheel, true);
    document.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("touchstart", handleTouchStart, true);
      document.removeEventListener("touchmove", handleTouchMove, true);
      document.removeEventListener("wheel", handleWheel, true);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [toolbarRef]);

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
