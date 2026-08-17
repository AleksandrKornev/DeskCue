import type { MutableRefObject } from "react";

export interface UseManagedSessionMobilePageScrollEffectsArgs {
  activeTab: string;
  isCompactViewport: boolean;
  liveChatSourceSessionId: string | null;
  programmaticPageScrollRef: MutableRefObject<boolean>;
  shouldStickPageToBottomRef: MutableRefObject<boolean>;
  shouldStickToBottomRef: MutableRefObject<boolean>;
  syncMobilePageToChatBottom: () => void;
}
