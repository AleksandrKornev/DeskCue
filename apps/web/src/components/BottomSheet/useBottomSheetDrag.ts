import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef
} from "react";
import type { PointerEventHandler } from "react";

import {
  BOTTOM_SHEET_EXIT_PADDING,
  BOTTOM_SHEET_FLING_DISTANCE,
  BOTTOM_SHEET_FLING_VELOCITY,
  BOTTOM_SHEET_MOTION_MS
} from "./constants";
import {
  captureBottomSheetPointer,
  getBottomSheetDismissDistance,
  isBottomSheetDragOrigin,
  isBottomSheetViewport,
  isInteractiveBottomSheetTarget,
  prefersReducedMotion,
  releaseBottomSheetPointer
} from "./helpers";
import type {
  BottomSheetGestureState,
  UseBottomSheetDragOptions,
  UseBottomSheetDragResult
} from "./types";

export function useBottomSheetDrag<TSheet extends HTMLElement>({
  onDismiss
}: UseBottomSheetDragOptions): UseBottomSheetDragResult<TSheet> {
  const sheetRef = useRef<TSheet | null>(null);
  const gestureRef = useRef<BottomSheetGestureState | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const enterFrameRef = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const settleSheet = useCallback((dismiss: boolean) => {
    const sheet = sheetRef.current;
    if (!sheet) {
      return;
    }

    clearDismissTimer();
    sheet.style.transition = prefersReducedMotion()
      ? "none"
      : `transform ${BOTTOM_SHEET_MOTION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    sheet.style.willChange = "transform";
    sheet.style.transform = dismiss
      ? `translateY(${sheet.getBoundingClientRect().height + BOTTOM_SHEET_EXIT_PADDING}px)`
      : "translateY(0)";

    dismissTimerRef.current = window.setTimeout(() => {
      dismissTimerRef.current = null;
      if (dismiss) {
        onDismissRef.current();
        return;
      }

      sheet.style.transition = "";
      sheet.style.willChange = "";
      sheet.style.transform = "";
    }, prefersReducedMotion() ? 0 : BOTTOM_SHEET_MOTION_MS);
  }, [clearDismissTimer]);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet || !isBottomSheetViewport() || prefersReducedMotion()) {
      return;
    }

    sheet.style.transition = "none";
    sheet.style.transform = "translateY(100%)";
    sheet.style.willChange = "transform";
    enterFrameRef.current = window.requestAnimationFrame(() => {
      enterFrameRef.current = null;
      sheet.style.transition = `transform ${BOTTOM_SHEET_MOTION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      sheet.style.transform = "translateY(0)";
      dismissTimerRef.current = window.setTimeout(() => {
        dismissTimerRef.current = null;
        sheet.style.transition = "";
        sheet.style.transform = "";
        sheet.style.willChange = "";
      }, BOTTOM_SHEET_MOTION_MS);
    });

    return () => {
      if (enterFrameRef.current !== null) {
        window.cancelAnimationFrame(enterFrameRef.current);
        enterFrameRef.current = null;
      }
      clearDismissTimer();
    };
  }, [clearDismissTimer]);

  const handlePointerDown = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    if (
      !isBottomSheetViewport() ||
      event.button !== 0 ||
      event.isPrimary === false ||
      isInteractiveBottomSheetTarget(event.target)
    ) {
      return;
    }

    const sheet = sheetRef.current;
    if (!sheet) {
      return;
    }

    if (!isBottomSheetDragOrigin(event.target, sheet, event.clientY)) {
      return;
    }

    clearDismissTimer();
    const now = event.timeStamp;
    gestureRef.current = {
      lastTime: now,
      lastY: event.clientY,
      offset: 0,
      pointerId: event.pointerId,
      startY: event.clientY,
      velocity: 0
    };
    captureBottomSheetPointer(event.currentTarget, event.pointerId);
    sheet.style.transition = "none";
    sheet.style.willChange = "transform";
  }, [clearDismissTimer]);

  const handlePointerMove = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    const gesture = gestureRef.current;
    const sheet = sheetRef.current;
    if (!gesture || !sheet || gesture.pointerId !== event.pointerId) {
      return;
    }

    const offset = Math.max(0, event.clientY - gesture.startY);
    const elapsed = Math.max(1, event.timeStamp - gesture.lastTime);
    gesture.velocity = (event.clientY - gesture.lastY) / elapsed;
    gesture.lastTime = event.timeStamp;
    gesture.lastY = event.clientY;
    gesture.offset = offset;
    sheet.style.transform = `translateY(${offset}px)`;
    event.preventDefault();
  }, []);

  const finishGesture = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    const gesture = gestureRef.current;
    const sheet = sheetRef.current;
    if (!gesture || !sheet || gesture.pointerId !== event.pointerId) {
      return;
    }

    releaseBottomSheetPointer(event.currentTarget, gesture.pointerId);
    gestureRef.current = null;
    const dismissDistance = getBottomSheetDismissDistance(sheet.getBoundingClientRect().height);
    const dismiss = gesture.offset >= dismissDistance || (
      gesture.offset >= BOTTOM_SHEET_FLING_DISTANCE &&
      gesture.velocity >= BOTTOM_SHEET_FLING_VELOCITY
    );
    settleSheet(dismiss);
  }, [settleSheet]);

  const cancelGesture = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    releaseBottomSheetPointer(event.currentTarget, gesture.pointerId);
    gestureRef.current = null;
    settleSheet(false);
  }, [settleSheet]);

  return {
    dragHandleProps: {
      "data-bottom-sheet-drag-handle": true
    },
    sheetGestureProps: {
      onPointerCancel: cancelGesture,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishGesture
    },
    sheetRef
  };
}
