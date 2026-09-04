import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { flushSync } from "react-dom";

import {
  findActiveSessionScrollTarget,
  findVerticalScrollTarget,
  MOBILE_HEADER_BOTTOM_KEEP_EXPANDED_DISTANCE_PX,
  MOBILE_HEADER_BOTTOM_REVEAL_DISTANCE_PX,
  MOBILE_HEADER_COLLAPSE_DISTANCE_PX,
  MOBILE_HEADER_COLLAPSE_MEDIA_QUERY,
  MOBILE_HEADER_EXPAND_DISTANCE_PX,
  preserveMobileScrollAnchor,
  readCollapsibleSessionMetaHeight,
  readDistanceFromScrollBottom,
  syncLiveChatToolbarHeight
} from "./mobileSessionHeaderCollapse";
import type { MobileScrollDirection } from "./mobileSessionHeaderCollapse";
import type { LiveSessionHeaderProps } from "./types";

type ResponsiveCollapseReset = {
  previousScrollTop: number;
  previousToolbarHeight: number;
  scrollTarget: HTMLElement | null;
};

const MINIMUM_MOBILE_CHAT_SURFACE_HEIGHT_PX = 72;

function hasConstrainedMobileChatHeight(
  toolbar: HTMLDivElement | null,
  isCollapsed: boolean
) {
  const chatSurface = toolbar?.parentElement?.querySelector<HTMLElement>(
    "[data-chat-surface]"
  );
  const collapsibleMeta = toolbar?.querySelector<HTMLElement>(
    "[data-collapsible-session-meta]"
  );

  if (!toolbar || !chatSurface) return false;

  const currentSurfaceHeight = chatSurface.getBoundingClientRect().height;
  const fullMetaHeight = collapsibleMeta?.scrollHeight ?? 0;
  const renderedMetaHeight = Math.min(
    fullMetaHeight,
    collapsibleMeta?.getBoundingClientRect().height ?? 0
  );
  const projectedExpandedSurfaceHeight = isCollapsed
    ? currentSurfaceHeight - Math.max(0, fullMetaHeight - renderedMetaHeight)
    : currentSurfaceHeight;

  return projectedExpandedSurfaceHeight < MINIMUM_MOBILE_CHAT_SURFACE_HEIGHT_PX;
}

function readCollapsibleHeaderControl(
  toolbar: HTMLDivElement | null,
  target: EventTarget | null
) {
  const targetElement = target instanceof Element ? target : null;
  const control = targetElement?.closest<HTMLElement>("button, [tabindex]") ?? null;
  const collapsibleHeader = toolbar?.querySelector("[data-collapsible-session-meta]");

  return control && collapsibleHeader?.contains(control) ? control : null;
}

function prepareCollapsibleHeaderForCollapse(
  toolbar: HTMLDivElement | null,
  pointerFocusedControl: HTMLElement | null
) {
  const activeElement = document.activeElement;
  const collapsibleHeader = toolbar?.querySelector("[data-collapsible-session-meta]");

  if (
    !(activeElement instanceof HTMLElement) ||
    !(collapsibleHeader instanceof HTMLElement) ||
    !collapsibleHeader.contains(activeElement)
  ) return true;

  if (activeElement !== pointerFocusedControl) return false;

  activeElement.blur();

  return true;
}

function readMobileHeaderCollapseViewport() {
  return typeof window !== "undefined" &&
    window.matchMedia(MOBILE_HEADER_COLLAPSE_MEDIA_QUERY).matches;
}

function shouldRevealMobileHeaderAfterTabChange(
  scrollTarget: HTMLElement | null,
  activeTab: LiveSessionHeaderProps["activeTab"]
) {
  if (!scrollTarget) return true;
  if (scrollTarget.scrollHeight <= scrollTarget.clientHeight) return true;
  if (scrollTarget.scrollTop <= MOBILE_HEADER_EXPAND_DISTANCE_PX) return true;
  if (activeTab !== "overview") return false;

  const distanceFromBottom = readDistanceFromScrollBottom(scrollTarget);

  return distanceFromBottom !== null && distanceFromBottom <= MOBILE_HEADER_BOTTOM_REVEAL_DISTANCE_PX;
}

function subscribeToMobileHeaderCollapseViewport(handleChange: () => void) {
  const mediaQuery = window.matchMedia(MOBILE_HEADER_COLLAPSE_MEDIA_QUERY);

  mediaQuery.addEventListener("change", handleChange);

  return () => mediaQuery.removeEventListener("change", handleChange);
}

function useMobileHeaderCollapseViewport() {
  return useSyncExternalStore(
    subscribeToMobileHeaderCollapseViewport,
    readMobileHeaderCollapseViewport,
    () => false
  );
}

export function useMobileSessionHeaderCollapse({
  activeTab,
  toolbarRef
}: Pick<LiveSessionHeaderProps, "activeTab" | "toolbarRef">) {
  const [isMobileCollapsed, setIsMobileCollapsed] = useState(false);
  const canCollapseHeader = useMobileHeaderCollapseViewport();
  const activeTabRef = useRef(activeTab);
  const activeScrollTargetRef = useRef<HTMLElement | null>(null);
  const isMobileCollapsedRef = useRef(false);
  const isVerticalBudgetForcedRef = useRef(false);
  const observedToolbarHeightRef = useRef<number | null>(null);
  const previousActiveTabRef = useRef(activeTab);
  const pendingPointerMetadataControlRef = useRef<HTMLElement | null>(null);
  const pointerFocusedMetadataControlRef = useRef<HTMLElement | null>(null);
  const responsiveCollapseResetRef = useRef<ResponsiveCollapseReset | null>(null);

  const enforceMinimumChatSurfaceHeight = useCallback(() => {
    const toolbar = toolbarRef.current;
    const isCollapsed = isMobileCollapsedRef.current;
    const isConstrained = hasConstrainedMobileChatHeight(toolbar, isCollapsed);

    if (!canCollapseHeader || activeTabRef.current !== "overview") {
      isVerticalBudgetForcedRef.current = false;
      return;
    }

    if (isCollapsed) {
      if (isConstrained) {
        isVerticalBudgetForcedRef.current = true;
      } else if (isVerticalBudgetForcedRef.current) {
        isVerticalBudgetForcedRef.current = false;
        isMobileCollapsedRef.current = false;
        setIsMobileCollapsed(false);
      }

      return;
    }

    if (
      !canCollapseHeader ||
      !isConstrained ||
      !prepareCollapsibleHeaderForCollapse(toolbar, pointerFocusedMetadataControlRef.current)
    ) return;

    isVerticalBudgetForcedRef.current = true;
    isMobileCollapsedRef.current = true;
    setIsMobileCollapsed(true);
  }, [canCollapseHeader, toolbarRef]);

  const preserveAnchorAfterToolbarResize = useCallback(() => {
    const toolbar = toolbarRef.current;

    if (!toolbar) return;

    const previousToolbarHeight = observedToolbarHeightRef.current;
    const nextToolbarHeight = toolbar.offsetHeight;

    observedToolbarHeightRef.current = nextToolbarHeight;
    syncLiveChatToolbarHeight(toolbar);

    if (previousToolbarHeight === null || previousToolbarHeight === nextToolbarHeight) {
      enforceMinimumChatSurfaceHeight();
      return;
    }

    const scrollTarget = findActiveSessionScrollTarget(
      toolbar,
      activeScrollTargetRef.current
    );

    activeScrollTargetRef.current = scrollTarget;
    preserveMobileScrollAnchor(
      scrollTarget,
      nextToolbarHeight - previousToolbarHeight,
      scrollTarget?.scrollTop ?? 0
    );

    enforceMinimumChatSurfaceHeight();
  }, [enforceMinimumChatSurfaceHeight, toolbarRef]);

  activeTabRef.current = activeTab;

  useLayoutEffect(() => {
    const activeScrollTarget = findActiveSessionScrollTarget(
      toolbarRef.current,
      activeScrollTargetRef.current
    );

    activeScrollTargetRef.current = activeScrollTarget;

    const activeTabChanged = previousActiveTabRef.current !== activeTab;

    previousActiveTabRef.current = activeTab;

    if (
      activeTabChanged &&
      isMobileCollapsedRef.current &&
      shouldRevealMobileHeaderAfterTabChange(activeScrollTarget, activeTab)
    ) {
      isMobileCollapsedRef.current = false;
      isVerticalBudgetForcedRef.current = false;
      setIsMobileCollapsed(false);
    }

    enforceMinimumChatSurfaceHeight();
  }, [activeTab, enforceMinimumChatSurfaceHeight, toolbarRef]);

  useLayoutEffect(() => {
    if (!canCollapseHeader && isMobileCollapsed) {
      const toolbar = toolbarRef.current;
      const scrollTarget = findActiveSessionScrollTarget(
        toolbar,
        activeScrollTargetRef.current
      );

      responsiveCollapseResetRef.current = {
        previousScrollTop: scrollTarget?.scrollTop ?? 0,
        previousToolbarHeight: toolbar?.offsetHeight ?? 0,
        scrollTarget
      };

      isMobileCollapsedRef.current = false;
      isVerticalBudgetForcedRef.current = false;
      setIsMobileCollapsed(false);
      return;
    }

    const pendingReset = responsiveCollapseResetRef.current;

    if (!pendingReset || isMobileCollapsed) return;

    responsiveCollapseResetRef.current = null;

    const toolbar = toolbarRef.current;
    const toolbarHeightDelta = (toolbar?.offsetHeight ?? pendingReset.previousToolbarHeight) -
      pendingReset.previousToolbarHeight;

    observedToolbarHeightRef.current = toolbar?.offsetHeight ?? null;
    syncLiveChatToolbarHeight(toolbar);
    preserveMobileScrollAnchor(
      pendingReset.scrollTarget,
      toolbarHeightDelta,
      pendingReset.previousScrollTop
    );
  }, [canCollapseHeader, isMobileCollapsed, toolbarRef]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;

    if (!canCollapseHeader || !toolbar) {
      observedToolbarHeightRef.current = toolbar?.offsetHeight ?? null;
      return;
    }

    observedToolbarHeightRef.current = toolbar.offsetHeight;
    syncLiveChatToolbarHeight(toolbar);
    window.addEventListener("resize", preserveAnchorAfterToolbarResize);
    window.visualViewport?.addEventListener("resize", preserveAnchorAfterToolbarResize);
    enforceMinimumChatSurfaceHeight();

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("resize", preserveAnchorAfterToolbarResize);
        window.visualViewport?.removeEventListener("resize", preserveAnchorAfterToolbarResize);
      };
    }

    const resizeObserver = new ResizeObserver(preserveAnchorAfterToolbarResize);
    const chatSurface = toolbar.parentElement?.querySelector<HTMLElement>(
      "[data-chat-surface]"
    );

    resizeObserver.observe(toolbar);
    if (chatSurface) resizeObserver.observe(chatSurface);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", preserveAnchorAfterToolbarResize);
      window.visualViewport?.removeEventListener("resize", preserveAnchorAfterToolbarResize);
    };
  }, [canCollapseHeader, enforceMinimumChatSurfaceHeight, preserveAnchorAfterToolbarResize, toolbarRef]);

  useEffect(() => {
    if (!canCollapseHeader) return;

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
          scrollLifecycle.activeTarget = scrollTarget;
          activeScrollTargetRef.current = scrollTarget;
          scrollLifecycle.accumulatedDistance = 0;
          scrollLifecycle.intentDirection = null;
          scrollLifecycle.lastScrollTop = scrollTarget.scrollTop;
          scrollLifecycle.updateCollapsed(false);
          return;
        }

        if (scrollLifecycle.activeTarget !== scrollTarget) {
          scrollLifecycle.activeTarget = scrollTarget;
          activeScrollTargetRef.current = scrollTarget;
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
          scrollTarget.scrollTop > Math.max(
            MOBILE_HEADER_COLLAPSE_DISTANCE_PX,
            readCollapsibleSessionMetaHeight(toolbarRef.current)
          ) &&
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
      handleFocusIn(event: FocusEvent) {
        const pointerCandidate = pendingPointerMetadataControlRef.current;

        pendingPointerMetadataControlRef.current = null;
        pointerFocusedMetadataControlRef.current = event.target === pointerCandidate
          ? pointerCandidate
          : null;
        enforceMinimumChatSurfaceHeight();
      },
      handleFocusOut() {
        queueMicrotask(enforceMinimumChatSurfaceHeight);
      },
      handleKeyDown() {
        pendingPointerMetadataControlRef.current = null;
        pointerFocusedMetadataControlRef.current = null;
      },
      handlePointerDown(event: PointerEvent) {
        const pointerCandidate = readCollapsibleHeaderControl(
          toolbarRef.current,
          event.target
        );

        pendingPointerMetadataControlRef.current = pointerCandidate;
        pointerFocusedMetadataControlRef.current = null;
      },
      handlePointerCancel() {
        pendingPointerMetadataControlRef.current = null;
        pointerFocusedMetadataControlRef.current = null;
      },
      handlePointerUp() {
        const pointerCandidate = pendingPointerMetadataControlRef.current;

        pendingPointerMetadataControlRef.current = null;
        if (pointerCandidate && document.activeElement === pointerCandidate) {
          pointerFocusedMetadataControlRef.current = pointerCandidate;
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
        activeScrollTargetRef.current = scrollTarget;
        scrollLifecycle.intentDirection = nextDirection;
        scrollLifecycle.lastScrollTop = scrollTarget.scrollTop;
      },
      updateCollapsed(nextCollapsed: boolean) {
        if (
          !nextCollapsed &&
          isVerticalBudgetForcedRef.current &&
          hasConstrainedMobileChatHeight(toolbarRef.current, true)
        ) return;

        if (!nextCollapsed) isVerticalBudgetForcedRef.current = false;
        if (
          nextCollapsed &&
          !prepareCollapsibleHeaderForCollapse(
            toolbarRef.current,
            pointerFocusedMetadataControlRef.current
          )
        ) return;
        if (isMobileCollapsedRef.current === nextCollapsed) return;

        pendingPointerMetadataControlRef.current = null;
        pointerFocusedMetadataControlRef.current = null;

        const toolbar = toolbarRef.current;

        const scrollTarget = scrollLifecycle.activeTarget;
        const previousScrollTop = scrollTarget?.scrollTop ?? 0;
        const previousToolbarHeight = toolbar?.offsetHeight ?? 0;

        flushSync(() => {
          isMobileCollapsedRef.current = nextCollapsed;
          setIsMobileCollapsed(nextCollapsed);
        });

        const toolbarHeightDelta = (toolbar?.offsetHeight ?? previousToolbarHeight) - previousToolbarHeight;

        observedToolbarHeightRef.current = toolbar?.offsetHeight ?? null;
        syncLiveChatToolbarHeight(toolbar);
        preserveMobileScrollAnchor(scrollTarget, toolbarHeightDelta, previousScrollTop);
      }
    };

    document.addEventListener("touchstart", scrollLifecycle.handleTouchStart, true);
    document.addEventListener("touchmove", scrollLifecycle.handleTouchMove, true);
    document.addEventListener("wheel", scrollLifecycle.handleWheel, true);
    document.addEventListener("scroll", scrollLifecycle.handleScroll, true);
    document.addEventListener("focusin", scrollLifecycle.handleFocusIn, true);
    document.addEventListener("focusout", scrollLifecycle.handleFocusOut, true);
    document.addEventListener("keydown", scrollLifecycle.handleKeyDown, true);
    document.addEventListener("pointerdown", scrollLifecycle.handlePointerDown, true);
    document.addEventListener("pointerup", scrollLifecycle.handlePointerUp, true);
    document.addEventListener("pointercancel", scrollLifecycle.handlePointerCancel, true);

    return () => {
      document.removeEventListener("touchstart", scrollLifecycle.handleTouchStart, true);
      document.removeEventListener("touchmove", scrollLifecycle.handleTouchMove, true);
      document.removeEventListener("wheel", scrollLifecycle.handleWheel, true);
      document.removeEventListener("scroll", scrollLifecycle.handleScroll, true);
      document.removeEventListener("focusin", scrollLifecycle.handleFocusIn, true);
      document.removeEventListener("focusout", scrollLifecycle.handleFocusOut, true);
      document.removeEventListener("keydown", scrollLifecycle.handleKeyDown, true);
      document.removeEventListener("pointerdown", scrollLifecycle.handlePointerDown, true);
      document.removeEventListener("pointerup", scrollLifecycle.handlePointerUp, true);
      document.removeEventListener("pointercancel", scrollLifecycle.handlePointerCancel, true);
    };
  }, [canCollapseHeader, enforceMinimumChatSurfaceHeight, toolbarRef]);

  return isMobileCollapsed;
}
