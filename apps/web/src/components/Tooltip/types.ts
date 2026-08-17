import type { CSSProperties, ReactNode } from "react";

export type TooltipAnchor = "trigger" | "parent";

export type TooltipPlacement = "above" | "below" | "left" | "right";

export type TooltipProps = {
  anchor?: TooltipAnchor;
  ariaLabel?: string;
  children?: ReactNode;
  className?: string;
  fitContent?: boolean;
  placement?: TooltipPlacement;
  tapToOpen?: boolean;
  tooltipClassName?: string;
  value: string;
};

export type TooltipPoint = {
  x: number;
  y: number;
};

export type TooltipPosition = {
  left: number;
  top: number;
};

export type TooltipLayoutInput = {
  anchor: TooltipAnchor;
  placement: TooltipPlacement;
  rootElement: HTMLElement;
  tooltipElement: HTMLElement;
  viewportHeight: number;
  viewportWidth: number;
};

export type TooltipLayout = {
  placement: TooltipPlacement;
  position: TooltipPosition;
};

export type TouchSourceMouseEvent = MouseEvent & {
  sourceCapabilities?: {
    firesTouchEvents?: boolean;
  };
};

export type ActiveTouch = {
  openedAt: number;
  pointerId: number;
  startPoint: TooltipPoint;
};

export type UseTooltipControllerParams = {
  anchor: TooltipAnchor;
  placement: TooltipPlacement;
  tapToOpen: boolean;
  value: string;
};

export type TooltipControllerStyle = CSSProperties;
