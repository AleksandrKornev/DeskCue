import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCurrentAgentSessionActionGuard } from "./useCurrentAgentSessionActionGuard";

describe("useCurrentAgentSessionActionGuard", () => {
  it("tracks selection changes and invalidates actions after unmount", () => {
    const { result, rerender, unmount } = renderHook(
      ({ sessionId }) => useCurrentAgentSessionActionGuard(sessionId),
      { initialProps: { sessionId: "session-1" } }
    );

    expect(result.current.current).toBe("session-1");
    rerender({ sessionId: "session-2" });
    expect(result.current.current).toBe("session-2");
    unmount();
    expect(result.current.current).toBeNull();
  });
});
