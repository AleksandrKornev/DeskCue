import { useLayoutEffect, useState } from "react";
import type {
  Dispatch,
  SetStateAction
} from "react";

import { emptyMobileChatViewportMetrics } from "@modules/session/chat/scroll/constants";
import { areMobileChatViewportMetricsEqual } from "@modules/session/chat/scroll/helpers";
import type { MobileChatViewportMetrics } from "@modules/session/chat/scroll/types";

import type { UseMobileChatViewportMetricsArgs } from "./types";

class MobileChatViewportObserver {
  private readonly mutationObserver: MutationObserver | null;
  private readonly resizeObserver: ResizeObserver | null;

  constructor(
    private readonly composerElement: HTMLDivElement,
    private readonly toolbarElement: HTMLDivElement,
    private readonly updateMetrics: Dispatch<SetStateAction<MobileChatViewportMetrics>>
  ) {
    this.resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(this.measure);
    this.mutationObserver = this.resizeObserver || typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(this.measure);
  }

  connect() {
    this.measure();
    this.resizeObserver?.observe(this.toolbarElement);
    this.resizeObserver?.observe(this.composerElement);
    this.mutationObserver?.observe(this.toolbarElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
    this.mutationObserver?.observe(this.composerElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });

    window.addEventListener("resize", this.measure);
    window.visualViewport?.addEventListener("resize", this.measure);
  }

  disconnect() {
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    window.removeEventListener("resize", this.measure);
    window.visualViewport?.removeEventListener("resize", this.measure);
  }

  private readonly measure = () => {
    const toolbarHeight = this.toolbarElement.offsetHeight;
    const nextMetrics = {
      composerHeight: Math.ceil(this.composerElement.getBoundingClientRect().height),
      stickyOffset: 0,
      // The tab strip deliberately hangs halfway over the chat surface.
      // offsetHeight retains the layout height of the header, unlike a
      // transformed bounding rect, so the surface still starts at the seam.
      toolbarHeight
    };

    this.updateMetrics((current) => (
      areMobileChatViewportMetricsEqual(current, nextMetrics) ? current : nextMetrics
    ));
  };
}

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
      !isCompactViewport ||
      !isTakenOverChat ||
      activeTab !== "overview"
    ) return;

    const toolbarElement = chatToolbarRef.current;
    const composerElement = chatComposerShellRef.current;

    if (!toolbarElement || !composerElement) return;

    const viewportObserver = new MobileChatViewportObserver(
      composerElement,
      toolbarElement,
      setMobileChatViewportMetrics
    );

    viewportObserver.connect();

    return () => viewportObserver.disconnect();
  }, [activeTab, chatComposerShellRef, chatToolbarRef, isCompactViewport, isTakenOverChat]);

  return mobileChatViewportMetrics;
}
