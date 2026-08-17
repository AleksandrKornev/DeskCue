import clsx from "clsx";
import { createPortal } from "react-dom";

import styles from "./styles.module.scss";
import type { TooltipProps } from "./types";
import { useTooltipController } from "./useTooltipController";

export function Tooltip({
  anchor = "trigger",
  ariaLabel,
  children,
  className,
  fitContent = false,
  placement = "above",
  tapToOpen = false,
  tooltipClassName,
  value
}: TooltipProps) {
  const text = children ?? value;
  const {
    handlePointerEnter,
    handlePointerLeave,
    handleTriggerBlur,
    handleTriggerClick,
    handleTriggerFocus,
    handleTriggerKeyDown,
    handleTriggerPointerDown,
    handleTriggerPointerMove,
    isOpen,
    resolvedPlacement,
    rootRef,
    tooltipId,
    tooltipRef,
    tooltipStyle
  } = useTooltipController({
    anchor,
    placement,
    tapToOpen,
    value
  });

  return (
    <span
      className={clsx(styles.root, fitContent && styles.rootFitContent)}
      ref={rootRef}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <span
        aria-label={ariaLabel}
        aria-describedby={isOpen ? tooltipId : undefined}
        className={clsx(styles.trigger, className)}
        role={tapToOpen ? "button" : undefined}
        tabIndex={tapToOpen ? 0 : undefined}
        onBlur={tapToOpen ? handleTriggerBlur : undefined}
        onClick={tapToOpen ? handleTriggerClick : undefined}
        onFocus={tapToOpen ? handleTriggerFocus : undefined}
        onKeyDown={tapToOpen ? handleTriggerKeyDown : undefined}
        onPointerDown={handleTriggerPointerDown}
        onPointerMove={handleTriggerPointerMove}
      >
        {text}
      </span>
      {isOpen ? createPortal(
        <span
          className={clsx(
            styles.tooltip,
            resolvedPlacement === "below" && styles.tooltipBelow,
            resolvedPlacement === "left" && styles.tooltipLeft,
            resolvedPlacement === "right" && styles.tooltipRight,
            tooltipClassName
          )}
          id={tooltipId}
          ref={tooltipRef}
          role="tooltip"
          style={tooltipStyle}
        >
          {value}
        </span>,
        document.body
      ) : null}
    </span>
  );
}
