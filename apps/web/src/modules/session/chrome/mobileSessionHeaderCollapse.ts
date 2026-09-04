export const MOBILE_HEADER_COLLAPSE_DISTANCE_PX = 18;
export const MOBILE_HEADER_BOTTOM_REVEAL_DISTANCE_PX = 24;
export const MOBILE_HEADER_BOTTOM_KEEP_EXPANDED_DISTANCE_PX = 120;
export const MOBILE_HEADER_EXPAND_DISTANCE_PX = 12;
export const MOBILE_HEADER_COLLAPSE_MEDIA_QUERY =
  "(max-width: 720px), (max-height: 640px)";

export type MobileScrollDirection = "down" | "up";

function isVerticalScrollOwner(element: HTMLElement) {
  const overflowY = window.getComputedStyle(element).overflowY;

  return element.scrollHeight > element.clientHeight && /^(auto|overlay|scroll)$/.test(overflowY);
}

export function readCollapsibleSessionMetaHeight(toolbar: HTMLDivElement | null) {
  const meta = toolbar?.querySelector("[data-collapsible-session-meta]");

  return meta instanceof HTMLElement ? Math.ceil(meta.getBoundingClientRect().height) : 0;
}

export function preserveMobileScrollAnchor(
  scrollTarget: HTMLElement | null,
  toolbarHeightDelta: number,
  previousScrollTop = scrollTarget?.scrollTop ?? 0
) {
  if (!scrollTarget || toolbarHeightDelta === 0) return;

  scrollTarget.scrollTop = Math.max(0, previousScrollTop + toolbarHeightDelta);
}

export function syncLiveChatToolbarHeight(toolbar: HTMLDivElement | null) {
  if (!toolbar) return;

  const chatSurface = toolbar.parentElement?.querySelector<HTMLElement>("[data-chat-surface]");

  chatSurface?.parentElement?.style.setProperty("--chat-toolbar-height", `${toolbar.offsetHeight}px`);
}

export function findVerticalScrollTarget(target: EventTarget | null, sessionSurface: HTMLElement) {
  let element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  const fallback = element instanceof HTMLElement ? element : element?.parentElement ?? null;

  while (element && element !== sessionSurface) {
    if (element instanceof HTMLElement && isVerticalScrollOwner(element)) return element;

    element = element.parentElement;
  }

  return fallback;
}

export function findActiveSessionScrollTarget(
  toolbar: HTMLDivElement | null,
  currentTarget: HTMLElement | null
) {
  const sessionSurface = toolbar?.parentElement;
  const activePanel = sessionSurface?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');

  if (!activePanel) {
    return currentTarget && sessionSurface?.contains(currentTarget) ? currentTarget : null;
  }

  if (
    currentTarget &&
    activePanel.contains(currentTarget) &&
    isVerticalScrollOwner(currentTarget)
  ) return currentTarget;
  if (isVerticalScrollOwner(activePanel)) return activePanel;

  return Array.from(activePanel.querySelectorAll<HTMLElement>("*")).find(isVerticalScrollOwner) ?? activePanel;
}

export function readDistanceFromScrollBottom(scrollTarget: HTMLElement) {
  if (scrollTarget.scrollHeight <= scrollTarget.clientHeight) return null;

  return Math.max(
    0,
    scrollTarget.scrollHeight - scrollTarget.clientHeight - scrollTarget.scrollTop
  );
}
