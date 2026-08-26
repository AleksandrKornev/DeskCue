import type { MobileChatViewportMetrics } from "./types";

export const CHAT_HISTORY_LOAD_THRESHOLD_PX = 160;
export const CHAT_HISTORY_AUTO_LOAD_IDLE_DELAY_MS = 600;
export const CHAT_HISTORY_AUTO_LOAD_REARM_DELAY_MS = 900;
export const CHAT_HISTORY_AUTO_LOAD_INTENT_WINDOW_MS = 1_500;
export const SCROLL_TO_LATEST_THRESHOLD_PX = 96;
export const COMPACT_CHAT_MEDIA_QUERY =
  "(max-width: 720px), (max-height: 640px)";
export const CHAT_SCROLL_BOTTOM_SENTINEL = 1_000_000_000;
export const CHAT_SCROLL_METRIC_REFRESH_IDLE_DELAY_MS = 180;
export const HISTORY_AUTO_LOAD_PENDING_MIN_MS = 850;

export const emptyMobileChatViewportMetrics: MobileChatViewportMetrics = {
  composerHeight: 0,
  stickyOffset: 0,
  toolbarHeight: 0
};
