import type {
  MutableRefObject,
  RefObject
} from "react";

export const CHAT_AUTO_STICK_SETTLE_DELAYS_MS = [80, 180, 420, 900, 1_400];
export const CHAT_AUTO_STICK_RELEASE_DELAY_MS = 600;

type SyncChatToBottomOptions = {
  scrollChatToBottom: () => void;
  syncMobilePageToChatBottom: () => void;
  updateShowScrollToLatest: (nextValue: boolean) => void;
  syncMobilePage?: boolean;
};

export function isLiveOverviewChat(activeTab: string, liveChatSourceSessionId: string) {
  return Boolean(liveChatSourceSessionId) && activeTab === "overview";
}

export function syncChatToBottom({
  scrollChatToBottom,
  syncMobilePage = true,
  syncMobilePageToChatBottom,
  updateShowScrollToLatest
}: SyncChatToBottomOptions) {
  if (syncMobilePage) {
    syncMobilePageToChatBottom();
    updateShowScrollToLatest(false);
    return;
  }

  scrollChatToBottom();
  updateShowScrollToLatest(false);
}

export function syncChatToBottomIfSticky({
  chatThreadRef,
  scrollChatToBottom,
  syncMobilePage,
  shouldStickToBottomRef,
  syncMobilePageToChatBottom,
  updateShowScrollToLatest
}: SyncChatToBottomOptions & {
  chatThreadRef: RefObject<HTMLDivElement | null>;
  shouldStickToBottomRef: MutableRefObject<boolean>;
}) {
  if (!shouldStickToBottomRef.current || !chatThreadRef.current) {
    return;
  }

  syncChatToBottom({
    scrollChatToBottom,
    syncMobilePage,
    syncMobilePageToChatBottom,
    updateShowScrollToLatest
  });
}
