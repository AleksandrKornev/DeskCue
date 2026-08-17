import {
  useCallback,
  useEffect,
  useRef
} from "react";
import type {
  MutableRefObject,
  RefObject
} from "react";

import { CHAT_SCROLL_BOTTOM_SENTINEL } from "@modules/session/chat/scroll/constants";

import { readElementPageTop } from "./helpers";

export function useManagedSessionMobilePageSync({
  chatSurfaceRef,
  chatThreadRef,
  chatToolbarRef,
  isCompactViewport,
  scrollChatToBottom,
  shouldStickPageToBottomRef,
  shouldStickToBottomRef,
  usePageScrollForChat
}: {
  chatSurfaceRef: RefObject<HTMLDivElement | null>;
  chatThreadRef: RefObject<HTMLDivElement | null>;
  chatToolbarRef: RefObject<HTMLDivElement | null>;
  isCompactViewport: boolean;
  scrollChatToBottom: () => void;
  shouldStickPageToBottomRef: MutableRefObject<boolean>;
  shouldStickToBottomRef: MutableRefObject<boolean>;
  usePageScrollForChat: boolean;
}) {
  const programmaticPageScrollRef = useRef(false);
  const programmaticPageScrollTimerRef = useRef<number | null>(null);

  const markProgrammaticPageScroll = useCallback(() => {
    programmaticPageScrollRef.current = true;

    if (programmaticPageScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticPageScrollTimerRef.current);
    }

    programmaticPageScrollTimerRef.current = window.setTimeout(() => {
      programmaticPageScrollRef.current = false;
      programmaticPageScrollTimerRef.current = null;
    }, 80);
  }, [programmaticPageScrollRef, programmaticPageScrollTimerRef]);

  const syncMobilePageToChatBottom = useCallback(() => {
    if (
      !isCompactViewport ||
      !shouldStickPageToBottomRef.current
    ) {
      return;
    }

    if (!usePageScrollForChat) {
      const activeChatElement = chatToolbarRef.current ?? chatSurfaceRef.current;
      const scrollingElement = document.scrollingElement ?? document.documentElement;
      const activeChatTop = activeChatElement
        ? readElementPageTop(activeChatElement, scrollingElement)
        : 0;
      const nextScrollTop = Math.max(
        0,
        Math.min(activeChatTop - 12, scrollingElement.scrollHeight - window.innerHeight)
      );

      if (shouldStickToBottomRef.current && chatThreadRef.current) {
        scrollChatToBottom();
      }

      markProgrammaticPageScroll();
      window.scrollTo({ top: nextScrollTop, left: 0, behavior: "auto" });
      return;
    }

    const scrollPageToBottom = () => {
      markProgrammaticPageScroll();
      window.scrollTo({ top: CHAT_SCROLL_BOTTOM_SENTINEL });
    };

    if (shouldStickToBottomRef.current && chatThreadRef.current) {
      scrollChatToBottom();
    }

    scrollPageToBottom();

    window.requestAnimationFrame(() => {
      if (shouldStickToBottomRef.current && chatThreadRef.current) {
        scrollChatToBottom();
      }
      scrollPageToBottom();
    });
  }, [
    chatSurfaceRef,
    chatThreadRef,
    chatToolbarRef,
    isCompactViewport,
    markProgrammaticPageScroll,
    scrollChatToBottom,
    shouldStickPageToBottomRef,
    shouldStickToBottomRef,
    usePageScrollForChat
  ]);

  useEffect(() => () => {
    if (programmaticPageScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticPageScrollTimerRef.current);
    }
  }, [programmaticPageScrollTimerRef]);

  return {
    programmaticPageScrollRef,
    syncMobilePageToChatBottom
  };
}
