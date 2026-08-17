import type {
  TooltipControllerStyle,
  TooltipLayout,
  TooltipLayoutInput,
  TooltipPlacement,
  TooltipPoint,
  TouchSourceMouseEvent
} from "./types";

export function getTooltipStyle(layout: TooltipLayout | null): TooltipControllerStyle {
  const position = layout?.position;

  return {
    left: `${position?.left ?? 0}px`,
    top: `${position?.top ?? 0}px`,
    visibility: layout === null ? "hidden" : "visible"
  };
}

const viewportMargin = 8;
const tooltipGap = 8;
const touchMoveCloseThresholdPx = 10;
const touchScrollIgnoreMs = 900;
const coarsePointerQuery = "(hover: none), (pointer: coarse)";
const fallbackPlacements: Record<TooltipPlacement, TooltipPlacement[]> = {
  above: ["above", "below", "right", "left"],
  below: ["below", "above", "right", "left"],
  left: ["left", "right", "above", "below"],
  right: ["right", "left", "above", "below"]
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function isTooltipOpenedEvent(
  event: Event
): event is CustomEvent<{ tooltipId?: string }> {
  return event instanceof CustomEvent;
}

export function isCoarsePointerViewport() {
  return window.matchMedia(coarsePointerQuery).matches;
}

export function isTouchLikeMouseEvent(event: TouchSourceMouseEvent) {
  return event.sourceCapabilities?.firesTouchEvents === true || isCoarsePointerViewport();
}

export function hasPointerMovedPastThreshold(
  startPoint: TooltipPoint,
  pointer: Pick<PointerEvent, "clientX" | "clientY">
) {
  const deltaX = Math.abs(pointer.clientX - startPoint.x);
  const deltaY = Math.abs(pointer.clientY - startPoint.y);

  return Math.max(deltaX, deltaY) >= touchMoveCloseThresholdPx;
}

export function shouldIgnoreTouchScroll(openedAt: number) {
  return openedAt > 0 && performance.now() - openedAt < touchScrollIgnoreMs;
}

export function resolveTooltipLayout({
  anchor,
  placement,
  rootElement,
  tooltipElement,
  viewportHeight,
  viewportWidth
}: TooltipLayoutInput): TooltipLayout {
  const anchorElement =
    anchor === "parent" ? rootElement.parentElement ?? rootElement : rootElement;
  const rootRect = anchorElement.getBoundingClientRect();
  const tooltipHeight = tooltipElement.offsetHeight;
  const tooltipWidth = tooltipElement.offsetWidth;
  const availableAbove = Math.max(0, rootRect.top - viewportMargin);
  const availableBelow = Math.max(0, viewportHeight - rootRect.bottom - viewportMargin);
  const availableLeft = Math.max(0, rootRect.left - viewportMargin);
  const availableRight = Math.max(0, viewportWidth - rootRect.right - viewportMargin);
  const availableByPlacement: Record<TooltipPlacement, number> = {
    above: availableAbove,
    below: availableBelow,
    left: availableLeft,
    right: availableRight
  };
  const requiredByPlacement: Record<TooltipPlacement, number> = {
    above: tooltipHeight + tooltipGap,
    below: tooltipHeight + tooltipGap,
    left: tooltipWidth + tooltipGap,
    right: tooltipWidth + tooltipGap
  };
  const nextPlacement =
    fallbackPlacements[placement].find(
      (candidate) => requiredByPlacement[candidate] <= availableByPlacement[candidate]
    ) ??
    ([...fallbackPlacements[placement]].sort(
      (left, right) =>
        availableByPlacement[right] - requiredByPlacement[right] -
        (availableByPlacement[left] - requiredByPlacement[left])
    )[0] ?? placement);

  const maxLeft = Math.max(viewportMargin, viewportWidth - viewportMargin - tooltipWidth);
  const maxTop = Math.max(viewportMargin, viewportHeight - viewportMargin - tooltipHeight);
  let nextLeft = rootRect.left;
  let nextTop = rootRect.bottom + tooltipGap;

  if (nextPlacement === "above") {
    nextLeft = clamp(rootRect.left, viewportMargin, maxLeft);
    nextTop = clamp(rootRect.top - tooltipGap - tooltipHeight, viewportMargin, maxTop);
  } else if (nextPlacement === "below") {
    nextLeft = clamp(rootRect.left, viewportMargin, maxLeft);
    nextTop = clamp(rootRect.bottom + tooltipGap, viewportMargin, maxTop);
  } else if (nextPlacement === "left") {
    nextLeft = clamp(rootRect.left - tooltipGap - tooltipWidth, viewportMargin, maxLeft);
    nextTop = clamp(
      rootRect.top + (rootRect.height - tooltipHeight) / 2,
      viewportMargin,
      maxTop
    );
  } else {
    nextLeft = clamp(rootRect.right + tooltipGap, viewportMargin, maxLeft);
    nextTop = clamp(
      rootRect.top + (rootRect.height - tooltipHeight) / 2,
      viewportMargin,
      maxTop
    );
  }

  return {
    placement: nextPlacement,
    position: {
      left: nextLeft,
      top: nextTop
    }
  };
}
