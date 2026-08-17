import type {
  PointerEventHandler,
  RefObject
} from "react";

export type BottomSheetGestureState = {
  lastTime: number;
  lastY: number;
  offset: number;
  pointerId: number;
  startY: number;
  velocity: number;
};

export type BottomSheetDragHandleProps = {
  "data-bottom-sheet-drag-handle": true;
};

export type BottomSheetGestureProps = {
  onPointerCancel: PointerEventHandler<HTMLElement>;
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
};

export type UseBottomSheetDragOptions = {
  onDismiss: () => void;
};

export type UseBottomSheetDragResult<TSheet extends HTMLElement> = {
  dragHandleProps: BottomSheetDragHandleProps;
  sheetGestureProps: BottomSheetGestureProps;
  sheetRef: RefObject<TSheet | null>;
};
