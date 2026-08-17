import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveSessionHeader } from "./LiveSessionHeader";
import styles from "./styles.module.scss";

vi.mock("@assets/images/icon-reload.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

function setScrollMetrics(
  element: HTMLElement,
  metrics: {
    clientHeight?: number;
    scrollHeight?: number;
    scrollTop: number;
  }
) {
  for (const [property, value] of Object.entries(metrics)) {
    Object.defineProperty(element, property, {
      configurable: true,
      value
    });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LiveSessionHeader", () => {
  it("keeps the agent, compaction count, and live state in the session metadata", () => {
    render(
      <LiveSessionHeader
        activeTab="preview"
        actions={<button type="button">More actions</button>}
        adapterLabel="CODEX"
        contextCompactionCount={92}
        isAgentChat={false}
        liveUpdatesConnection={{
          lastSyncedAt: null,
          status: "connecting"
        }}
        navigationCapabilities={{
          changes: true,
          conversation: true,
          files: true,
          output: false,
          preview: true
        }}
        navigationIdPrefix="test-session"
        status="running"
        statusLabel="Ready"
        subtitle="D:\\work\\DeskCueWorkspace"
        title="Continue HTTPS Preview DeskCue"
        toolbarRef={createRef<HTMLDivElement>()}
        onSelectTab={vi.fn()}
      />
    );

    expect(screen.getByText("CODEX")).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "Earlier context was compacted 92 times in this native session."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("collapses on downward mobile scrolling and expands when scrolling back up", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true
    })));
    const toolbarRef = createRef<HTMLDivElement>();

    render(
      <div>
        <LiveSessionHeader
          activeTab="overview"
          actions={<button type="button">More actions</button>}
          adapterLabel="CODEX"
          contextCompactionCount={4}
          isAgentChat={false}
          liveUpdatesConnection={{
            lastSyncedAt: null,
            status: "connecting"
          }}
          navigationCapabilities={{
            changes: true,
            conversation: true,
            files: true,
            output: false,
            preview: true
          }}
          navigationIdPrefix="mobile-session"
          status="running"
          subtitle="D:\\work\\DeskCueWorkspace"
          title="Continue HTTPS Preview DeskCue"
          toolbarRef={toolbarRef}
          onSelectTab={vi.fn()}
        />
        <div data-testid="session-scroll-target" />
      </div>
    );

    const scrollTarget = screen.getByTestId("session-scroll-target");
    setScrollMetrics(scrollTarget, { scrollTop: 48 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);

    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);

    setScrollMetrics(scrollTarget, { scrollTop: 72 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
    expect(toolbarRef.current?.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("tablist", { name: "Session sections" })).toBeVisible();

    setScrollMetrics(scrollTarget, { scrollTop: 60 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    fireEvent.wheel(scrollTarget, { deltaY: -20 });
    setScrollMetrics(scrollTarget, { scrollTop: 44 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
    expect(toolbarRef.current?.firstElementChild).toHaveAttribute("aria-hidden", "false");
  });

  it("keeps the header expanded near the bottom and reveals it at the end of chat", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true
    })));
    const toolbarRef = createRef<HTMLDivElement>();

    render(
      <div>
        <LiveSessionHeader
          activeTab="overview"
          actions={<button type="button">More actions</button>}
          adapterLabel="CODEX"
          contextCompactionCount={4}
          isAgentChat={false}
          liveUpdatesConnection={{
            lastSyncedAt: null,
            status: "connecting"
          }}
          navigationCapabilities={{
            changes: true,
            conversation: true,
            files: true,
            output: false,
            preview: true
          }}
          navigationIdPrefix="mobile-session"
          status="running"
          subtitle="D:\\work\\DeskCueWorkspace"
          title="Continue HTTPS Preview DeskCue"
          toolbarRef={toolbarRef}
          onSelectTab={vi.fn()}
        />
        <div data-testid="session-scroll-target" />
      </div>
    );

    const scrollTarget = screen.getByTestId("session-scroll-target");
    setScrollMetrics(scrollTarget, {
      clientHeight: 500,
      scrollHeight: 1_000,
      scrollTop: 280
    });
    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, {
      clientHeight: 500,
      scrollHeight: 1_000,
      scrollTop: 304
    });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    setScrollMetrics(scrollTarget, {
      clientHeight: 500,
      scrollHeight: 1_000,
      scrollTop: 480
    });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);

    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, {
      clientHeight: 500,
      scrollHeight: 1_000,
      scrollTop: 404
    });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
  });

  it("preserves the collapsed header when the active tab changes", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true
    })));
    const toolbarRef = createRef<HTMLDivElement>();
    const onSelectTab = vi.fn();
    const renderHeader = (activeTab: "diff" | "overview") => (
      <div>
        <LiveSessionHeader
          activeTab={activeTab}
          actions={<button type="button">More actions</button>}
          adapterLabel="CODEX"
          contextCompactionCount={4}
          isAgentChat={false}
          liveUpdatesConnection={{
            lastSyncedAt: null,
            status: "connecting"
          }}
          navigationCapabilities={{
            changes: true,
            conversation: true,
            files: true,
            output: false,
            preview: true
          }}
          navigationIdPrefix="mobile-session"
          status="running"
          subtitle="D:\\work\\DeskCueWorkspace"
          title="Continue HTTPS Preview DeskCue"
          toolbarRef={toolbarRef}
          onSelectTab={onSelectTab}
        />
        <div data-testid="session-scroll-target" />
      </div>
    );
    const { rerender } = render(renderHeader("overview"));
    const scrollTarget = screen.getByTestId("session-scroll-target");

    setScrollMetrics(scrollTarget, { scrollTop: 48 });
    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, { scrollTop: 72 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    rerender(renderHeader("diff"));

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });
});
