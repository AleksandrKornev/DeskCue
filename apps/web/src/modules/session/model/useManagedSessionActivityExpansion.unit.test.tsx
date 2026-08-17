import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ConversationActivity } from "@modules/session/types";

import { useManagedSessionActivityExpansion } from "./useManagedSessionActivityExpansion";

function createActivity(
  kind: ConversationActivity["kind"],
  id: string
): ConversationActivity {
  return {
    entries: [],
    id,
    kind,
    label: kind,
    timestamp: "2026-08-07T10:00:00.000Z"
  };
}

describe("useManagedSessionActivityExpansion", () => {
  it("keeps only the latest non-change activity expanded", () => {
    const details = createActivity("details", "details-1");
    const tools = createActivity("tools", "tools-1");
    const { result } = renderHook(() => useManagedSessionActivityExpansion());

    act(() => result.current.toggleActivityGroup(details));
    expect(result.current.isActivityExpanded(details)).toBe(true);

    act(() => result.current.toggleActivityGroup(tools));
    expect(result.current.isActivityExpanded(details)).toBe(false);
    expect(result.current.isActivityExpanded(tools)).toBe(true);
  });

  it("collapses the active activity and resets expansion state", () => {
    const details = createActivity("details", "details-1");
    const { result } = renderHook(() => useManagedSessionActivityExpansion());

    act(() => result.current.toggleActivityGroup(details));
    act(() => result.current.toggleActivityGroup(details));
    expect(result.current.isActivityExpanded(details)).toBe(false);

    act(() => result.current.toggleActivityGroup(details));
    act(() => result.current.resetActivityExpansion());
    expect(result.current.isActivityExpanded(details)).toBe(false);
  });

  it("preserves the default-expanded change group behavior", () => {
    const changes = createActivity("changes", "changes-1");
    const { result } = renderHook(() => useManagedSessionActivityExpansion());

    expect(result.current.isActivityExpanded(changes)).toBe(true);

    act(() => result.current.toggleActivityGroup(changes));
    expect(result.current.isActivityExpanded(changes)).toBe(false);
  });
});
