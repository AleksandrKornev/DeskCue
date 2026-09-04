import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedTabs } from "./SegmentedTabs";

function createBounds(left: number, right: number): DOMRect {
  return {
    bottom: 48,
    height: 48,
    left,
    right,
    top: 0,
    width: right - left,
    x: left,
    y: 0,
    toJSON: () => ({})
  };
}

function mockHorizontalScroll(scroller: HTMLElement, clampAtZero = true) {
  const scrollBy = vi.fn((options: ScrollToOptions) => {
    const left = Number(options.left ?? 0);
    const nextScrollLeft = scroller.scrollLeft + left;

    scroller.scrollLeft = clampAtZero ? Math.max(0, nextScrollLeft) : nextScrollLeft;
  });

  Object.defineProperty(scroller, "scrollBy", {
    configurable: true,
    value: scrollBy
  });

  return scrollBy;
}

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

  it("brings the active tab into view when it changes", () => {
    const { rerender } = render(
      <SegmentedTabs
        activeTab="chat"
        ariaLabel="Session sections"
        options={[
          { key: "chat", label: "Chat" },
          { key: "activity", label: "Activity" }
        ]}
        onSelectTab={() => undefined}
      />
    );

    const tabList = screen.getByRole("tablist", { name: "Session sections" });
    const scroller = tabList.parentElement as HTMLElement;
    const activityTab = screen.getByRole("tab", { name: "Activity" });
    const scrollBy = mockHorizontalScroll(scroller);

    scroller.scrollLeft = 0;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(createBounds(0, 100));
    vi.spyOn(activityTab, "getBoundingClientRect").mockReturnValue(createBounds(110, 160));

    rerender(
      <SegmentedTabs
        activeTab="activity"
        ariaLabel="Session sections"
        options={[
          { key: "chat", label: "Chat" },
          { key: "activity", label: "Activity" }
        ]}
        onSelectTab={() => undefined}
      />
    );

    expect(scroller.scrollLeft).toBe(66);
    expect(scrollBy).toHaveBeenCalledWith({ left: 66 });
  });

  it("keeps the active tab horizontally visible without moving the page on resize", () => {
    render(
      <SegmentedTabs
        activeTab="activity"
        ariaLabel="Session sections"
        options={[
          { key: "chat", label: "Chat" },
          { key: "activity", label: "Activity" }
        ]}
        onSelectTab={() => undefined}
      />
    );

    const tabList = screen.getByRole("tablist", { name: "Session sections" });
    const scroller = tabList.parentElement as HTMLElement;
    const activityTab = screen.getByRole("tab", { name: "Activity" });
    const pageScroll = vi.spyOn(window, "scrollTo");
    const scrollBy = mockHorizontalScroll(scroller);

    scroller.scrollLeft = 20;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(createBounds(0, 100));
    vi.spyOn(activityTab, "getBoundingClientRect").mockReturnValue(createBounds(-20, 30));

    fireEvent(window, new Event("resize"));

    expect(scroller.scrollLeft).toBe(0);
    expect(scrollBy).toHaveBeenCalledWith({ left: -26 });
    expect(pageScroll).not.toHaveBeenCalled();
  });

  it("scrolls toward a hidden active tab in RTL layouts", () => {
    const { rerender } = render(
      <SegmentedTabs
        activeTab="activity"
        ariaLabel="Session sections"
        options={[
          { key: "chat", label: "Chat" },
          { key: "activity", label: "Activity" }
        ]}
        onSelectTab={() => undefined}
      />
    );

    const tabList = screen.getByRole("tablist", { name: "Session sections" });
    const scroller = tabList.parentElement as HTMLElement;
    const chatTab = screen.getByRole("tab", { name: "Chat" });
    const scrollBy = mockHorizontalScroll(scroller, false);

    scroller.dir = "rtl";
    scroller.scrollLeft = 0;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(createBounds(0, 100));
    vi.spyOn(chatTab, "getBoundingClientRect").mockReturnValue(createBounds(-40, 10));

    rerender(
      <SegmentedTabs
        activeTab="chat"
        ariaLabel="Session sections"
        options={[
          { key: "chat", label: "Chat" },
          { key: "activity", label: "Activity" }
        ]}
        onSelectTab={() => undefined}
      />
    );

    expect(scroller.scrollLeft).toBe(-46);
    expect(scrollBy).toHaveBeenCalledWith({ left: -46 });
  });
});
