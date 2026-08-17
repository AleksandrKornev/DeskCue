import { useLayoutEffect, useState } from "react";

import { emptyMobileChatViewportMetrics } from "@modules/session/chat/scroll/constants";
import { areMobileChatViewportMetricsEqual } from "@modules/session/chat/scroll/helpers";

import type { UseMobileChatViewportMetricsArgs } from "./types";

export function useMobileChatViewportMetrics({
  activeTab,
  chatComposerShellRef,
  chatToolbarRef,
  isCompactViewport,
  isTakenOverChat
}: UseMobileChatViewportMetricsArgs) {
  const [mobileChatViewportMetrics, setMobileChatViewportMetrics] = useState(emptyMobileChatViewportMetrics);

  useLayoutEffect(() => {
    if (
      typeof ResizeObserver === "undefined" ||
      !isCompactViewport ||
      !isTakenOverChat ||
      activeTab !== "overview"
    ) {
      return;
    }

    const toolbarElement = chatToolbarRef.current;
    const composerElement = chatComposerShellRef.current;
    if (!toolbarElement || !composerElement) {
      return;
    }

    const measure = () => {
      const nextMetrics = {
        composerHeight: Math.ceil(composerElement.getBoundingClientRect().height),
        stickyOffset: 0,
        // The tab strip deliberately hangs halfway over the chat surface.
        // offsetHeight retains the layout height of the header, unlike a
        // transformed bounding rect, so the surface still starts at the seam.
        toolbarHeight: toolbarElement.offsetHeight
      };

      setMobileChatViewportMetrics((current) =>
        areMobileChatViewportMetricsEqual(current, nextMetrics) ? current : nextMetrics
      );
    };

    let animationFrameId: number | null = null;
    const scheduleMeasure = () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        measure();
      });
    };

    measure();

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(toolbarElement);
    resizeObserver.observe(composerElement);

    window.addEventListener("resize", scheduleMeasure);
    window.visualViewport?.addEventListener("resize", scheduleMeasure);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.visualViewport?.removeEventListener("resize", scheduleMeasure);
    };
  }, [activeTab, chatComposerShellRef, chatToolbarRef, isCompactViewport, isTakenOverChat]);

  return mobileChatViewportMetrics;
}
