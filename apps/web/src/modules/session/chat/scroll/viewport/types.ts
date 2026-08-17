import type { MutableRefObject } from "react";

export type UseMobileChatViewportMetricsArgs = {
  activeTab: string;
  chatComposerShellRef: MutableRefObject<HTMLDivElement | null>;
  chatToolbarRef: MutableRefObject<HTMLDivElement | null>;
  isCompactViewport: boolean;
  isTakenOverChat: boolean;
};
