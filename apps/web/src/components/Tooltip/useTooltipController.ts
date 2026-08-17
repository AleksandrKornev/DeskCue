import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import {
  HOVER_OPEN_DELAY_MS,
  TOOLTIP_OPENED_EVENT_NAME
} from "./constants";
import {
  getTooltipStyle,
  hasPointerMovedPastThreshold,
  isCoarsePointerViewport,
  isTooltipOpenedEvent,
  isTouchLikeMouseEvent,
  resolveTooltipLayout,
  shouldIgnoreTouchScroll
} from "./helpers";
import type {
  ActiveTouch,
  TooltipLayout,
  UseTooltipControllerParams
} from "./types";

export function useTooltipController({
  anchor,
  placement,
  tapToOpen,
  value
}: UseTooltipControllerParams) {
  const tooltipId = useId();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const openDelayRef = useRef<number | null>(null);
  const activeTouchRef = useRef<ActiveTouch | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [layout, setLayout] = useState<TooltipLayout | null>(null);
  const tooltipStyle = getTooltipStyle(layout);

  const updateLayout = useCallback(() => {
    const rootElement = rootRef.current;
    const tooltipElement = tooltipRef.current;
    if (!rootElement || !tooltipElement) {
      return;
    }

    const nextLayout = resolveTooltipLayout({
      anchor,
      placement,
      rootElement,
      tooltipElement,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth
    });

    setLayout((current) =>
      current !== null &&
      current.placement === nextLayout.placement &&
      current.position.left === nextLayout.position.left &&
      current.position.top === nextLayout.position.top
        ? current
        : nextLayout
    );
  }, [anchor, placement]);

  const clearOpenDelay = useCallback(() => {
    if (openDelayRef.current === null) {
      return;
    }

    window.clearTimeout(openDelayRef.current);
    openDelayRef.current = null;
  }, []);

  const open = useCallback(() => {
    clearOpenDelay();
    document.dispatchEvent(
      new CustomEvent(TOOLTIP_OPENED_EVENT_NAME, {
        detail: { tooltipId }
      })
    );
    setIsOpen(true);
  }, [clearOpenDelay, tooltipId]);

  const close = useCallback(() => {
    clearOpenDelay();
    activeTouchRef.current = null;
    setIsOpen(false);
    setLayout(null);
  }, [clearOpenDelay]);

  const scheduleHoverOpen = useCallback(() => {
    clearOpenDelay();
    openDelayRef.current = window.setTimeout(() => {
      openDelayRef.current = null;
      open();
    }, HOVER_OPEN_DELAY_MS);
  }, [clearOpenDelay, open]);

  const handlePointerEnter = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.pointerType !== "touch") {
      scheduleHoverOpen();
    }
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.pointerType !== "touch") {
      close();
    }
  };

  const handleTriggerPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.pointerType !== "touch") {
      return;
    }

    event.stopPropagation();
    activeTouchRef.current = {
      openedAt: performance.now(),
      pointerId: event.pointerId,
      startPoint: {
        x: event.clientX,
        y: event.clientY
      }
    };
    open();
  };

  const handleTriggerPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const activeTouch = activeTouchRef.current;
    if (
      event.pointerType === "touch" &&
      activeTouch?.pointerId === event.pointerId &&
      hasPointerMovedPastThreshold(activeTouch.startPoint, event)
    ) {
      close();
    }
  };

  const handleTriggerClick = (event: ReactMouseEvent<HTMLSpanElement>) => {
    if (!tapToOpen) {
      return;
    }

    event.stopPropagation();
    if (!isTouchLikeMouseEvent(event.nativeEvent)) {
      open();
    }
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (!tapToOpen || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (isOpen) {
      close();
      return;
    }

    open();
  };

  const handleTriggerFocus = () => {
    if (tapToOpen && !isCoarsePointerViewport()) {
      open();
    }
  };

  const handleTriggerBlur = () => {
    if (tapToOpen && activeTouchRef.current === null) {
      close();
    }
  };

  useLayoutEffect(() => {
    if (isOpen) {
      updateLayout();
    }
  }, [isOpen, updateLayout, value]);

  useEffect(() => {
    return () => clearOpenDelay();
  }, [clearOpenDelay]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleTooltipOpened = (event: Event) => {
      if (isTooltipOpenedEvent(event) && event.detail.tooltipId !== tooltipId) {
        close();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        close();
        return;
      }

      if (!rootRef.current?.contains(target) && !tooltipRef.current?.contains(target)) {
        close();
      }
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        return;
      }

      const activeTouch = activeTouchRef.current;
      if (
        activeTouch === null ||
        (
          activeTouch.pointerId === event.pointerId &&
          hasPointerMovedPastThreshold(activeTouch.startPoint, event)
        )
      ) {
        close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    const handleScrollIntent = () => {
      const activeTouch = activeTouchRef.current;
      if (activeTouch && shouldIgnoreTouchScroll(activeTouch.openedAt)) {
        return;
      }

      close();
    };

    document.addEventListener(TOOLTIP_OPENED_EVENT_NAME, handleTooltipOpened);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateLayout);
    window.addEventListener("scroll", handleScrollIntent, true);

    return () => {
      document.removeEventListener(TOOLTIP_OPENED_EVENT_NAME, handleTooltipOpened);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateLayout);
      window.removeEventListener("scroll", handleScrollIntent, true);
    };
  }, [close, isOpen, tooltipId, updateLayout]);

  return {
    handlePointerEnter,
    handlePointerLeave,
    handleTriggerBlur,
    handleTriggerClick,
    handleTriggerFocus,
    handleTriggerKeyDown,
    handleTriggerPointerMove,
    handleTriggerPointerDown,
    isOpen,
    resolvedPlacement: layout?.placement ?? placement,
    rootRef,
    tooltipId,
    tooltipRef,
    tooltipStyle
  };
}
