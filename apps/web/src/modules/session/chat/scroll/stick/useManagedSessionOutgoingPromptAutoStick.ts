import { useEffect } from "react";
import type { MutableRefObject } from "react";

import { isLiveOverviewChat } from "./helpers";

export function useManagedSessionOutgoingPromptAutoStick({
  activeTab,
  forceChatToLatest,
  lastOutgoingPromptKeyRef,
  liveChatSourceSessionId,
  outgoingPromptKey
}: {
  activeTab: string;
  forceChatToLatest: () => void;
  lastOutgoingPromptKeyRef: MutableRefObject<string>;
  liveChatSourceSessionId: string;
  outgoingPromptKey: string;
}) {
  useEffect(() => {
    if (!isLiveOverviewChat(activeTab, liveChatSourceSessionId) || !outgoingPromptKey) {
      return;
    }

    if (lastOutgoingPromptKeyRef.current === outgoingPromptKey) {
      return;
    }

    lastOutgoingPromptKeyRef.current = outgoingPromptKey;
    forceChatToLatest();
  }, [
    activeTab,
    forceChatToLatest,
    lastOutgoingPromptKeyRef,
    liveChatSourceSessionId,
    outgoingPromptKey
  ]);
}
