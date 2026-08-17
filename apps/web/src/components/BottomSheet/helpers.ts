import {
  BOTTOM_SHEET_DRAG_HANDLE_SELECTOR,
  BOTTOM_SHEET_DISMISS_RATIO,
  BOTTOM_SHEET_HANDLE_HIT_AREA,
  BOTTOM_SHEET_INTERACTIVE_SELECTOR,
  BOTTOM_SHEET_MAX_DISMISS_DISTANCE,
  BOTTOM_SHEET_MEDIA_QUERY,
  BOTTOM_SHEET_MIN_DISMISS_DISTANCE,
  REDUCED_MOTION_MEDIA_QUERY
} from "./constants";

export function isBottomSheetViewport() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(BOTTOM_SHEET_MEDIA_QUERY).matches;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches;
}

export function isInteractiveBottomSheetTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(BOTTOM_SHEET_INTERACTIVE_SELECTOR));
}

export function isBottomSheetDragOrigin(
  target: EventTarget | null,
  sheet: HTMLElement,
  clientY: number
) {
  const startsInHeader = target instanceof Element &&
    Boolean(target.closest(BOTTOM_SHEET_DRAG_HANDLE_SELECTOR));
  const startsOnVisualHandle = clientY <=
    sheet.getBoundingClientRect().top + BOTTOM_SHEET_HANDLE_HIT_AREA;
  return startsInHeader || startsOnVisualHandle;
}

export function getBottomSheetDismissDistance(sheetHeight: number) {
  return Math.min(
    BOTTOM_SHEET_MAX_DISMISS_DISTANCE,
    Math.max(BOTTOM_SHEET_MIN_DISMISS_DISTANCE, sheetHeight * BOTTOM_SHEET_DISMISS_RATIO)
  );
}

export function captureBottomSheetPointer(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Pointer capture can disappear between pointerdown and React dispatch.
  }
}

export function releaseBottomSheetPointer(element: HTMLElement, pointerId: number) {
  try {
    if (element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // The browser may already have released capture during cancellation.
  }
}
