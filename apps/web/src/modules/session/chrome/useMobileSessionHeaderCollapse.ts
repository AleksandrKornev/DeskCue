import { useEffect, useRef, useState } from "react";

import { useCompactChatViewport } from "@modules/session/chat/scroll/viewport/useCompactChatViewport";

import {
  findVerticalScrollTarget,
  MOBILE_HEADER_BOTTOM_KEEP_EXPANDED_DISTANCE_PX,
  MOBILE_HEADER_BOTTOM_REVEAL_DISTANCE_PX,
  MOBILE_HEADER_COLLAPSE_DISTANCE_PX,
  MOBILE_HEADER_EXPAND_DISTANCE_PX,
  readDistanceFromScrollBottom
} from "./mobileSessionHeaderCollapse";
import type { MobileScrollDirection } from "./mobileSessionHeaderCollapse";
import type { LiveSessionHeaderProps } from "./types";

export function useMobileSessionHeaderCollapse({
  activeTab,
  toolbarRef
}: Pick<LiveSessionHeaderProps, "activeTab" | "toolbarRef">) {
  const [isMobileCollapsed, setIsMobileCollapsed] = useState(false);
  const isCompactViewport = useCompactChatViewport();
  const activeTabRef = useRef(activeTab);
  const isMobileCollapsedRef = useRef(false);

  activeTabRef.current = activeTab;

  useEffect(() => {
    if (!isCompactViewport) {
      isMobileCollapsedRef.current = false;
      setIsMobileCollapsed(false);
      return;
    }

    const scrollLifecycle = {
      activeTarget: null as HTMLElement | null,
      accumulatedDistance: 0,
      intentDirection: null as MobileScrollDirection | null,
      lastScrollTop: 0,
      lastTouchY: null as number | null,
      handleScroll(event: Event) {
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
          scrollLifecycle.updateCollapsed(false);
          scrollLifecycle.activeTarget = scrollTarget;
          scrollLifecycle.accumulatedDistance = 0;
          scrollLifecycle.intentDirection = null;
          scrollLifecycle.lastScrollTop = scrollTarget.scrollTop;
          return;
        }

        if (scrollLifecycle.activeTarget !== scrollTarget) {
          scrollLifecycle.lastScrollTop = scrollTarget.scrollTop;
          return;
        }

        const delta = scrollTarget.scrollTop - scrollLifecycle.lastScrollTop;

        scrollLifecycle.lastScrollTop = scrollTarget.scrollTop;

        if (delta === 0 || !scrollLifecycle.intentDirection) return;

        const scrollDirection = delta > 0 ? "down" : "up";

        if (scrollDirection !== scrollLifecycle.intentDirection) return;

        scrollLifecycle.accumulatedDistance += Math.abs(delta);

        if (
          scrollLifecycle.intentDirection === "down" &&
          scrollTarget.scrollTop > MOBILE_HEADER_COLLAPSE_DISTANCE_PX &&
          scrollLifecycle.accumulatedDistance >= MOBILE_HEADER_COLLAPSE_DISTANCE_PX
        ) {
          scrollLifecycle.updateCollapsed(true);
          scrollLifecycle.accumulatedDistance = 0;
          scrollLifecycle.intentDirection = null;
        } else if (
          scrollLifecycle.intentDirection === "up" &&
          scrollLifecycle.accumulatedDistance >= MOBILE_HEADER_EXPAND_DISTANCE_PX
        ) {
          scrollLifecycle.updateCollapsed(false);
          scrollLifecycle.accumulatedDistance = 0;
          scrollLifecycle.intentDirection = null;
        }
      },
      handleTouchMove(event: TouchEvent) {
        const currentTouchY = event.touches[0]?.clientY ?? null;

        if (
          scrollLifecycle.lastTouchY === null ||
          currentTouchY === null ||
          currentTouchY === scrollLifecycle.lastTouchY
        ) return;

        scrollLifecycle.setIntent(
          scrollLifecycle.readTarget(event),
          currentTouchY < scrollLifecycle.lastTouchY ? "down" : "up"
        );

        scrollLifecycle.lastTouchY = currentTouchY;
      },
      handleTouchStart(event: TouchEvent) {
        scrollLifecycle.lastTouchY = event.touches[0]?.clientY ?? null;
        scrollLifecycle.setIntent(scrollLifecycle.readTarget(event), null);
      },
      handleWheel(event: WheelEvent) {
        if (event.deltaY === 0) return;

        scrollLifecycle.setIntent(
          scrollLifecycle.readTarget(event),
          event.deltaY > 0 ? "down" : "up"
        );
      },
      readTarget(event: Event) {
        const sessionSurface = toolbarRef.current?.parentElement;

        if (!(event.target instanceof Node) || !sessionSurface?.contains(event.target)) return null;

        return findVerticalScrollTarget(event.target, sessionSurface);
      },
      setIntent(
        scrollTarget: HTMLElement | null,
        nextDirection: MobileScrollDirection | null
      ) {
        if (!scrollTarget) return;

        if (
          scrollTarget !== scrollLifecycle.activeTarget ||
          nextDirection !== scrollLifecycle.intentDirection
        ) scrollLifecycle.accumulatedDistance = 0;

        scrollLifecycle.activeTarget = scrollTarget;
        scrollLifecycle.intentDirection = nextDirection;
        scrollLifecycle.lastScrollTop = scrollTarget.scrollTop;
      },
      updateCollapsed(nextCollapsed: boolean) {
        isMobileCollapsedRef.current = nextCollapsed;
        setIsMobileCollapsed(nextCollapsed);
      }
    };

    document.addEventListener("touchstart", scrollLifecycle.handleTouchStart, true);
    document.addEventListener("touchmove", scrollLifecycle.handleTouchMove, true);
    document.addEventListener("wheel", scrollLifecycle.handleWheel, true);
    document.addEventListener("scroll", scrollLifecycle.handleScroll, true);

    return () => {
      document.removeEventListener("touchstart", scrollLifecycle.handleTouchStart, true);
      document.removeEventListener("touchmove", scrollLifecycle.handleTouchMove, true);
      document.removeEventListener("wheel", scrollLifecycle.handleWheel, true);
      document.removeEventListener("scroll", scrollLifecycle.handleScroll, true);
    };
  }, [isCompactViewport, toolbarRef]);

  return isMobileCollapsed;
}
