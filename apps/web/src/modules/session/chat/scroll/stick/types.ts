import type {
  MutableRefObject,
  RefObject
} from "react";

import type { MobileChatViewportMetrics } from "@modules/session/chat/scroll/types";

export type SyncBottom = (options?: { syncMobilePage?: boolean }) => void;

export type ChatAutoStickRefs = {
  allowAutoStickReleaseRef: MutableRefObject<boolean>;
  chatThreadRef: RefObject<HTMLDivElement | null>;
  shouldStickPageToBottomRef: MutableRefObject<boolean>;
  shouldStickToBottomRef: MutableRefObject<boolean>;
};

export type LiveChatAutoStickState = {
  activeTab: string;
  conversationTimelineLength: number;
  effectiveIsWaitingForChatReply: boolean;
  liveChatSessionId: string;
  liveChatSourceSessionId: string;
  mobileChatViewportMetrics: MobileChatViewportMetrics;
  outgoingPromptKey: string;
  usePageScrollForChat: boolean;
  visibleTimelineLimit: number;
};
