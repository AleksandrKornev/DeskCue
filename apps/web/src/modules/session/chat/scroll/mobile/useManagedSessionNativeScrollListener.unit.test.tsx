import { describe, expect, it } from "vitest";

import {
  CHAT_USER_SCROLL_INTENT_WINDOW_MS,
  hasRecentChatUserScrollIntent,
  shouldKeepAutoStickForNativeScroll,
  shouldReleaseAutoStickForNativeScroll
} from "./useManagedSessionNativeScrollListener";

describe("managed session native chat scroll intent", () => {
  it("does not treat the zero sentinel as user intent during cold open", () => {
    expect(hasRecentChatUserScrollIntent({ lastIntentAt: 0, now: 500 })).toBe(false);
    expect(hasRecentChatUserScrollIntent({ lastIntentAt: 100, now: 500 })).toBe(true);
  });

  it("keeps auto-stick when layout moves away from bottom without user scroll intent", () => {
    expect(
      shouldKeepAutoStickForNativeScroll({
        allowAutoStickRelease: true,
        hasRecentUserScrollIntent: false,
        isAwayFromBottom: true,
        shouldStickToBottom: true
      })
    ).toBe(true);
  });

  it("allows release when the user intentionally scrolls toward earlier history", () => {
    expect(
      shouldReleaseAutoStickForNativeScroll({
        hasRecentUserScrollIntent: true,
        isScrollingTowardHistoryGate: true
      })
    ).toBe(true);

    expect(
      shouldKeepAutoStickForNativeScroll({
        allowAutoStickRelease: true,
        hasRecentUserScrollIntent: true,
        isAwayFromBottom: true,
        shouldStickToBottom: true
      })
    ).toBe(false);
  });

  it("expires user scroll intent after the release window", () => {
    expect(
      hasRecentChatUserScrollIntent({
        lastIntentAt: 1_000,
        now: 1_000 + CHAT_USER_SCROLL_INTENT_WINDOW_MS
      })
    ).toBe(true);

    expect(
      hasRecentChatUserScrollIntent({
        lastIntentAt: 1_000,
        now: 1_001 + CHAT_USER_SCROLL_INTENT_WINDOW_MS
      })
    ).toBe(false);
  });
});
