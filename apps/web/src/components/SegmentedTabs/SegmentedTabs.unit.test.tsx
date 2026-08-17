import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedTabs } from "./SegmentedTabs";

describe("SegmentedTabs", () => {
  it("renders tab options and marks the active tab", () => {
    render(
      <SegmentedTabs
        activeTab="chat"
        ariaLabel="Session sections"
        idPrefix="session-1"
        options={[
          { key: "chat", label: "Chat" },
          { key: "activity", label: "Activity" }
        ]}
        onSelectTab={() => undefined}
      />
    );

    expect(screen.getByRole("tablist", { name: "Session sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute(
      "aria-controls",
      "session-1-panel-chat"
    );
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute(
      "id",
      "session-1-tab-chat"
    );
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelectTab with the selected key", () => {
    const onSelectTab = vi.fn();
    render(
      <SegmentedTabs
        activeTab="chat"
        ariaLabel="Session sections"
        options={[
          { key: "chat", label: "Chat" },
          { key: "activity", label: "Activity" }
        ]}
        onSelectTab={onSelectTab}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Activity" }));

    expect(onSelectTab).toHaveBeenCalledWith("activity");
  });

  it("supports arrow-key tab navigation", () => {
    const onSelectTab = vi.fn();
    render(
      <SegmentedTabs
        activeTab="chat"
        ariaLabel="Session sections"
        options={[
          { key: "chat", label: "Chat" },
          { key: "activity", label: "Activity" }
        ]}
        onSelectTab={onSelectTab}
      />
    );

    const chatTab = screen.getByRole("tab", { name: "Chat" });
    const activityTab = screen.getByRole("tab", { name: "Activity" });
    chatTab.focus();
    fireEvent.keyDown(chatTab, { key: "ArrowRight" });

    expect(onSelectTab).toHaveBeenCalledWith("activity");
    expect(activityTab).toHaveFocus();
  });
});
