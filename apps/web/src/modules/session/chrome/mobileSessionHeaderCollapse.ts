export const MOBILE_HEADER_COLLAPSE_DISTANCE_PX = 18;
export const MOBILE_HEADER_BOTTOM_REVEAL_DISTANCE_PX = 24;
export const MOBILE_HEADER_BOTTOM_KEEP_EXPANDED_DISTANCE_PX = 120;
export const MOBILE_HEADER_EXPAND_DISTANCE_PX = 12;

export type MobileScrollDirection = "down" | "up";

export function findVerticalScrollTarget(target: EventTarget | null, sessionSurface: HTMLElement) {
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

export function readDistanceFromScrollBottom(scrollTarget: HTMLElement) {
  if (scrollTarget.scrollHeight <= scrollTarget.clientHeight) return null;

  return Math.max(
    0,
    scrollTarget.scrollHeight - scrollTarget.clientHeight - scrollTarget.scrollTop
  );
}
