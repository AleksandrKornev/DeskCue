import { act, fireEvent, render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { createRef } from "react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import segmentedTabStyles from "@components/SegmentedTabs/styles.module.scss";

import { LiveSessionHeader } from "./LiveSessionHeader";
import { MOBILE_HEADER_COLLAPSE_MEDIA_QUERY } from "./mobileSessionHeaderCollapse";
import styles from "./styles.module.scss";

vi.mock("@assets/images/icon-reload.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

const resizeObserverCallbacks: ResizeObserverCallback[] = [];
const resizeObserverTargets: Element[] = [];

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallbacks.push(callback);
  }

  disconnect() {}

  observe(target: Element) {
    resizeObserverTargets.push(target);
  }

  unobserve() {}
}

function createMatchMediaController(initialMatches = true) {
  let matches = initialMatches;
  const listeners = new Set<EventListener>();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    addEventListener: vi.fn((_type: string, listener: EventListener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: EventListener) => listeners.delete(listener))
  } as unknown as MediaQueryList;
  const matchMedia = vi.fn(() => mediaQuery);

  return {
    matchMedia,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener(new Event("change")));
    }
  };
}

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
      writable: true,
      value
    });
  }
}

function getSessionStatusContainer() {
  const statusContainer = document.querySelector(`.${styles.headerStatus}`);

  if (!(statusContainer instanceof HTMLElement)) {
    throw new Error("Session status container was not rendered");
  }

  return statusContainer;
}

function getCollapsibleSessionMeta() {
  const meta = document.querySelector("[data-collapsible-session-meta]");

  if (!(meta instanceof HTMLElement)) {
    throw new Error("Collapsible session metadata was not rendered");
  }

  return meta;
}

function getFocusSafeHeaderElement(
  toolbarRef: RefObject<HTMLDivElement | null>,
  liveStatus: "live" | "reconnecting" = "live",
  sessionStatus: "failed" | "read_only" | "running" = "running",
  statusLabel?: string,
  includeViewportGeometry = false
) {
  return (
    <div>
      <LiveSessionHeader
        activeTab="overview"
        actions={<button type="button">More actions</button>}
        adapterLabel="CODEX"
        contextCompactionCount={0}
        isAgentChat={false}
        liveUpdatesConnection={{ lastSyncedAt: null, status: liveStatus }}
        navigationCapabilities={{
          changes: true,
          conversation: true,
          files: true,
          output: false,
          preview: true
        }}
        navigationIdPrefix="focus-safe-mobile-session"
        status={sessionStatus}
        statusLabel={statusLabel}
        subtitle="D:\\work\\DeskCueWorkspace"
        title="Focused session title"
        toolbarRef={toolbarRef}
        onExitSession={vi.fn()}
        onSelectTab={vi.fn()}
      />
      <div data-testid="focus-safe-scroll-target" />
      {includeViewportGeometry ? <div data-chat-surface data-testid="focus-safe-chat-surface" /> : null}
    </div>
  );
}

beforeEach(() => {
  resizeObserverCallbacks.length = 0;
  resizeObserverTargets.length = 0;
  vi.stubGlobal("matchMedia", createMatchMediaController(false).matchMedia);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LiveSessionHeader", () => {
  it("fills the compact header with all four source-chat tabs", () => {
    const { container } = render(
      <LiveSessionHeader
        activeTab="overview"
        actions={<button type="button">More actions</button>}
        adapterLabel="LM STUDIO"
        contextCompactionCount={0}
        isAgentChat={false}
        liveUpdatesConnection={{ lastSyncedAt: null, status: "live" }}
        navigationCapabilities={{
          changes: true,
          conversation: true,
          files: true,
          output: false,
          preview: true
        }}
        navigationIdPrefix="four-tab-session"
        status="read_only"
        statusLabel="ready"
        subtitle="Local chat"
        title="LM Studio chat"
        toolbarRef={createRef<HTMLDivElement>()}
        onExitSession={vi.fn()}
        onSelectTab={vi.fn()}
      />
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Chat",
      "Changes",
      "Files",
      "Preview"
    ]);
    expect(screen.getByRole("tablist").parentElement).toHaveClass(
      segmentedTabStyles.navFillMobile
    );

    expect(container.querySelector("[data-collapsible-session-meta]")).toHaveClass(styles.metaRow);

    expect(container.querySelector(`.${styles.compactionSlot}`)).toBeNull();
  });

  it("keeps the source, accessible compaction count, and live state in the session metadata", async () => {
    const onExitSession = vi.fn();

    const { container } = render(
      <LiveSessionHeader
        activeTab="preview"
        actions={<button type="button">More actions</button>}
        adapterLabel="LM STUDIO"
        contextCompactionCount={192}
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
        status="read_only"
        statusLabel="ready"
        subtitle="D:\\work\\DeskCueWorkspace"
        title="Continue HTTPS Preview DeskCue"
        toolbarRef={createRef<HTMLDivElement>()}
        onExitSession={onExitSession}
        onSelectTab={vi.fn()}
      />
    );

    expect(screen.getAllByText("LM STUDIO")).toHaveLength(2);
    const compactionLabel = "Earlier context was compacted 192 times in this native session. Compaction level is high; consider starting a new chat soon";
    const compactionAriaLabel = "Context compacted 192 times";
    const compactionPill = screen.getByRole("button", { name: compactionAriaLabel });

    expect(compactionPill).toHaveClass(styles.contextCompactionPill);
    expect(compactionPill).toHaveAttribute("aria-label", compactionAriaLabel);
    const axeResults = await axe.run(compactionPill, {
      runOnly: { type: "rule", values: ["aria-prohibited-attr"] }
    });

    expect(axeResults.violations).toEqual([]);

    const contextDisclosureLabel = "Runtime: LM STUDIO. Workspace: DeskCueWorkspace. Show full session context";
    const contextButton = screen.getByRole("button", { name: contextDisclosureLabel });
    const mobileCompactionMarker = container.querySelector(`.${styles.compactionSlot}`);

    expect(contextButton).toHaveAttribute("aria-expanded", "false");
    expect(contextButton).toHaveAttribute("aria-haspopup", "dialog");
    expect(mobileCompactionMarker).toHaveTextContent("192");
    expect(contextButton).toHaveTextContent("LM STUDIO·DeskCueWorkspace");
    expect(contextButton.querySelector('[data-runtime-icon="lm-studio"]')).toBeInTheDocument();
    expect(contextButton).toHaveAccessibleName(contextDisclosureLabel);

    const liveIndicator = screen.getByRole("button", { name: "Connecting live updates" });
    const mobileMetadataOrder = [
      getSessionStatusContainer(),
      mobileCompactionMarker,
      contextButton,
      liveIndicator
    ];

    for (let index = 0; index < mobileMetadataOrder.length - 1; index += 1) {
      const currentItem = mobileMetadataOrder[index];
      const nextItem = mobileMetadataOrder[index + 1];

      expect(currentItem).toBeInstanceOf(Node);
      expect(nextItem).toBeInstanceOf(Node);
      expect(currentItem?.compareDocumentPosition(nextItem as Node) ?? 0)
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }

    fireEvent.click(contextButton);
    const contextDialog = screen.getByRole("dialog", { name: "Session context" });

    expect(contextButton).toHaveAttribute("aria-expanded", "true");
    expect(within(contextDialog).getByText("LM STUDIO")).toBeInTheDocument();
    expect(within(contextDialog).getByText("DeskCueWorkspace")).toBeInTheDocument();
    expect(within(contextDialog).getByText("D:\\\\work\\\\DeskCueWorkspace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close session context" }));
    expect(contextButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(compactionPill);
    expect(screen.getByRole("tooltip")).toHaveTextContent(compactionLabel);
    fireEvent.click(compactionPill);

    expect(screen.getAllByText("Connecting")).not.toHaveLength(0);
    expect(
      screen.getByRole("heading", { name: "Continue HTTPS Preview DeskCue" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Session title: Continue HTTPS Preview DeskCue"
    })).toBeNull();
    expect(screen.getByRole("heading").firstElementChild).toHaveClass(styles.commandText);
    expect(getSessionStatusContainer()).toHaveTextContent("ready");
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    const header = container.querySelector(`.${styles.chatHeader}`);

    if (!(header instanceof HTMLElement)) {
      throw new Error("Session header was not rendered");
    }

    expect(
      within(header)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent)
    ).toEqual([
      "Back to chats",
      "More actions",
      "Session status: ready",
      compactionAriaLabel,
      contextDisclosureLabel,
      "Connecting live updates",
      "D:\\\\work\\\\DeskCueWorkspace"
    ]);
    expect(
      screen.getByRole("button", { name: "Back to chats" }).querySelector("svg")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to chats" }));
    expect(onExitSession).toHaveBeenCalledOnce();
  });

  it("keeps subagent identity in the compact session context", () => {
    render(
      <LiveSessionHeader
        activeTab="overview"
        actions={<button type="button">More actions</button>}
        adapterLabel="CODEX"
        contextCompactionCount={2}
        isAgentChat
        liveUpdatesConnection={{ lastSyncedAt: null, status: "live" }}
        navigationCapabilities={{
          changes: true,
          conversation: true,
          files: true,
          output: false,
          preview: true
        }}
        navigationIdPrefix="subagent-session"
        status="running"
        subtitle="D:\\work\\DeskCueWorkspace"
        title="Subagent task"
        toolbarRef={createRef<HTMLDivElement>()}
        onExitSession={vi.fn()}
        onSelectTab={vi.fn()}
      />
    );

    const contextButton = screen.getByRole("button", {
      name: "Subagent session. Runtime: CODEX. Workspace: DeskCueWorkspace. Show full session context"
    });
    const previousHistoryState: unknown = window.history.state;

    expect(contextButton.querySelector(`.${styles.mobileSubagentIcon}`)).toBeInTheDocument();
    fireEvent.click(contextButton);
    expect(within(screen.getByRole("dialog", { name: "Session context" }))
      .getByText("Subagent")).toBeInTheDocument();

    window.history.replaceState(previousHistoryState, "");
    fireEvent.popState(window);

    expect(screen.queryByRole("dialog", { name: "Session context" })).not.toBeInTheDocument();
  });

  it("maps compaction counts to low, elevated, and high attention levels", () => {
    const renderHeader = (count: number) => (
      <LiveSessionHeader
        activeTab="overview"
        actions={<button type="button">More actions</button>}
        adapterLabel="CODEX"
        contextCompactionCount={count}
        isAgentChat={false}
        liveUpdatesConnection={{ lastSyncedAt: null, status: "live" }}
        navigationCapabilities={{
          changes: true,
          conversation: true,
          files: true,
          output: false,
          preview: true
        }}
        navigationIdPrefix="compaction-severity"
        status="running"
        statusLabel="ready"
        subtitle="D:\\work\\DeskCueWorkspace"
        title="Compaction levels"
        toolbarRef={createRef<HTMLDivElement>()}
        onExitSession={vi.fn()}
        onSelectTab={vi.fn()}
      />
    );
    const { rerender } = render(renderHeader(1));

    expect(screen.getByRole("button", { name: "Context compacted 1 time" }))
      .toHaveClass(styles.contextCompactionLow);

    rerender(renderHeader(5));
    expect(screen.getByRole("button", { name: "Context compacted 5 times" }))
      .toHaveClass(styles.contextCompactionElevated);

    rerender(renderHeader(6));
    expect(screen.getByRole("button", { name: "Context compacted 6 times" }))
      .toHaveClass(styles.contextCompactionHigh);
  });

  it("only exposes the full session title disclosure when the heading is clipped", () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(20);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(40);

    render(getFocusSafeHeaderElement(createRef<HTMLDivElement>()));

    const heading = screen.getByRole("heading", { name: "Focused session title" });
    const titleElement = heading.querySelector(`.${styles.commandText}`);

    if (!(titleElement instanceof HTMLElement)) {
      throw new Error("Session title was not rendered");
    }

    const titleDisclosure = screen.getByRole("button", {
      name: "Session title: Focused session title"
    });

    fireEvent.click(titleDisclosure);

    expect(screen.getByRole("tooltip")).toHaveTextContent("Focused session title");
  });

  it("keeps title disclosure focus until the user leaves after the heading fits", () => {
    let scrollHeight = 40;

    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(20);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => scrollHeight);

    render(getFocusSafeHeaderElement(createRef<HTMLDivElement>()));

    const titleDisclosure = screen.getByRole("button", {
      name: "Session title: Focused session title"
    });

    act(() => titleDisclosure.focus());
    scrollHeight = 20;
    fireEvent.resize(window);

    expect(titleDisclosure).toHaveFocus();

    act(() => titleDisclosure.blur());

    expect(screen.queryByRole("button", {
      name: "Session title: Focused session title"
    })).toBeNull();
    expect(screen.getByRole("heading", { name: "Focused session title" })).toBeInTheDocument();
  });

  it("observes the replacement title node after focus-safe disclosure removal", () => {
    let scrollHeight = 40;

    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(20);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => scrollHeight);

    render(getFocusSafeHeaderElement(createRef<HTMLDivElement>()));

    const titleDisclosure = screen.getByRole("button", {
      name: "Session title: Focused session title"
    });

    act(() => titleDisclosure.focus());
    scrollHeight = 20;
    act(() => resizeObserverCallbacks.at(-1)?.([], {} as ResizeObserver));
    act(() => titleDisclosure.blur());

    const replacementTitle = screen.getByRole("heading").querySelector(`.${styles.commandText}`);

    expect(replacementTitle).toBeInstanceOf(HTMLElement);
    expect(resizeObserverTargets).toContain(replacementTitle);

    scrollHeight = 40;
    act(() => resizeObserverCallbacks.at(-1)?.([], {} as ResizeObserver));

    expect(screen.getByRole("button", {
      name: "Session title: Focused session title"
    })).toBeInTheDocument();
  });

  it("keeps status in session context without treating every explicit label as a warning", () => {
    const renderHeader = (
      status: "failed" | "read_only" | "running" | "stopped",
      statusLabel?: string
    ) => (
      <LiveSessionHeader
        activeTab="overview"
        actions={<button type="button">More actions</button>}
        adapterLabel="CODEX"
        contextCompactionCount={0}
        isAgentChat={false}
        liveUpdatesConnection={{
          lastSyncedAt: null,
          status: "live"
        }}
        navigationCapabilities={{
          changes: true,
          conversation: true,
          files: true,
          output: false,
          preview: true
        }}
        navigationIdPrefix="status-session"
        status={status}
        statusLabel={statusLabel}
        subtitle="D:\\work\\DeskCueWorkspace"
        title="A long session title that must not compete with status"
        toolbarRef={createRef<HTMLDivElement>()}
        onExitSession={vi.fn()}
        onSelectTab={vi.fn()}
      />
    );
    const { rerender } = render(renderHeader("read_only", "ready"));
    const getStatusBadge = () => getSessionStatusContainer()
      .querySelector(`.${styles.headerStatusBadge}`);

    expect(getSessionStatusContainer().closest(`.${styles.metaRow}`)).toHaveClass(styles.metaRow);
    expect(screen.getByRole("button", { name: "Session status: ready" })).toBeInTheDocument();
    expect(getStatusBadge()).not.toHaveClass(styles.headerStatusBadgeActionable);
    expect(getStatusBadge()).toHaveClass(styles.headerStatusBadgePositive);
    expect(screen.getByRole("heading")).toHaveTextContent(
      "A long session title that must not compete with status"
    );

    rerender(renderHeader("read_only", "control lost"));

    expect(getStatusBadge()).toHaveClass(styles.headerStatusBadgeActionable);
    expect(getStatusBadge()).not.toHaveClass(styles.headerStatusBadgePositive);

    rerender(renderHeader("running"));

    expect(getStatusBadge()).toHaveClass(styles.headerStatusBadgePositive);
    expect(getStatusBadge()).not.toHaveClass(styles.headerStatusBadgeActionable);
    expect(screen.getByRole("button", { name: "Session status: running" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("status").some((region) => (
        region.textContent === "Session status: running"
      ))
    ).toBe(true);

    rerender(renderHeader("running", "stopping"));

    expect(getStatusBadge()).toHaveClass(styles.headerStatusBadgeActionable);
    expect(getStatusBadge()).not.toHaveClass(styles.headerStatusBadgePositive);
    expect(getStatusBadge()).not.toHaveClass(styles.headerStatusBadgeDanger);

    rerender(renderHeader("failed"));

    expect(getStatusBadge()).toHaveClass(styles.headerStatusBadgeDanger);
    expect(getStatusBadge()).not.toHaveClass(styles.headerStatusBadgeActionable);

    rerender(renderHeader("stopped"));

    expect(getStatusBadge()).toHaveClass(styles.headerStatusBadgeDanger);

    rerender(renderHeader("stopped", "ready"));

    expect(getStatusBadge()).not.toHaveClass(styles.headerStatusBadgeDanger);
  });

  it("collapses on downward mobile scrolling and expands when scrolling back up", () => {
    const { matchMedia, setMatches } = createMatchMediaController();

    vi.stubGlobal("matchMedia", matchMedia);
    const toolbarRef = createRef<HTMLDivElement>();

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function readBounds(
      this: HTMLElement
    ) {
      if (this.dataset.chatSurface !== undefined) return { height: 320 } as DOMRect;

      return { height: 0 } as DOMRect;
    });

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
          onExitSession={vi.fn()}
          onSelectTab={vi.fn()}
        />
        <div data-testid="session-scroll-target" />
        <div data-testid="chat-workspace">
          <div data-chat-surface />
        </div>
      </div>
    );

    expect(matchMedia).toHaveBeenCalledWith(MOBILE_HEADER_COLLAPSE_MEDIA_QUERY);

    const scrollTarget = screen.getByTestId("session-scroll-target");
    const chatWorkspace = screen.getByTestId("chat-workspace");

    Object.defineProperty(toolbarRef.current, "offsetHeight", {
      configurable: true,
      get: () => toolbarRef.current?.classList.contains(styles.chatToolbarCollapsed) ? 88 : 133
    });

    setScrollMetrics(scrollTarget, { scrollTop: 48 });

    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);

    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);

    setScrollMetrics(scrollTarget, { scrollTop: 72 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
    expect(scrollTarget.scrollTop).toBe(27);
    expect(chatWorkspace.style.getPropertyValue("--chat-toolbar-height")).toBe("88px");
    expect(getCollapsibleSessionMeta()).toHaveAttribute("aria-hidden", "true");
    expect(toolbarRef.current?.firstElementChild).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("button", { name: "Back to chats" })).toBeVisible();
    expect(screen.getByRole("button", { name: "More actions" })).toBeVisible();
    expect(screen.getByRole("tablist", { name: "Session sections" })).toBeVisible();

    setScrollMetrics(scrollTarget, { scrollTop: 60 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    fireEvent.wheel(scrollTarget, { deltaY: -20 });
    setScrollMetrics(scrollTarget, { scrollTop: 44 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
    expect(getCollapsibleSessionMeta()).toHaveAttribute("aria-hidden", "false");

    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, { scrollTop: 120 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    act(() => setMatches(false));

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
    expect(getCollapsibleSessionMeta()).toHaveAttribute("aria-hidden", "false");
    expect(scrollTarget.scrollTop).toBe(120);
    expect(chatWorkspace.style.getPropertyValue("--chat-toolbar-height")).toBe("133px");
  });

  it("keeps focused header controls visible while mobile scrolling requests collapse", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    const toolbarRef = createRef<HTMLDivElement>();

    const { rerender } = render(getFocusSafeHeaderElement(toolbarRef));

    const scrollTarget = screen.getByTestId("focus-safe-scroll-target");

    const contextButton = screen.getByRole("button", { name: /Workspace: DeskCueWorkspace/u });

    contextButton.focus();
    setScrollMetrics(scrollTarget, { scrollTop: 48 });
    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, { scrollTop: 72 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
    expect(getCollapsibleSessionMeta()).toHaveAttribute("aria-hidden", "false");

    screen.getByRole("button", { name: "More actions" }).focus();
    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, { scrollTop: 96 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
    expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Back to chats" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Chat" })).toBeVisible();

    rerender(getFocusSafeHeaderElement(toolbarRef, "reconnecting", "failed"));

    const connectionAnnouncement = screen.getByText("Live updates reconnecting");
    const failedAnnouncement = screen.getByText("Session status: failed");

    expect(connectionAnnouncement.closest('[aria-hidden="true"]')).toBeNull();
    expect(failedAnnouncement.closest('[aria-hidden="true"]')).toBeNull();

    rerender(getFocusSafeHeaderElement(toolbarRef, "reconnecting", "read_only", "control lost"));

    const controlLostAnnouncement = screen.getByText("Session status: control lost");

    expect(controlLostAnnouncement.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("preserves the active message anchor when responsive metadata changes toolbar height", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const toolbarRef = createRef<HTMLDivElement>();
    let toolbarHeight = 133;

    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function readOffsetHeight(
      this: HTMLElement
    ) {
      return this === toolbarRef.current ? toolbarHeight : 0;
    });

    render(getFocusSafeHeaderElement(toolbarRef));

    const scrollTarget = screen.getByTestId("focus-safe-scroll-target");

    setScrollMetrics(scrollTarget, {
      clientHeight: 100,
      scrollHeight: 400,
      scrollTop: 150
    });
    scrollTarget.style.overflowY = "auto";
    fireEvent.scroll(scrollTarget);

    const toolbarObserverIndex = resizeObserverTargets.indexOf(toolbarRef.current as Element);

    expect(toolbarObserverIndex).toBeGreaterThanOrEqual(0);

    toolbarHeight = 177;
    act(() => resizeObserverCallbacks[toolbarObserverIndex]?.([], {} as ResizeObserver));

    expect(scrollTarget.scrollTop).toBe(194);
  });

  it("preserves the active message anchor through every frame of header motion", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const toolbarRef = createRef<HTMLDivElement>();
    let toolbarHeight = 177;

    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function readOffsetHeight(
      this: HTMLElement
    ) {
      return this === toolbarRef.current ? toolbarHeight : 0;
    });

    render(getFocusSafeHeaderElement(toolbarRef));

    const scrollTarget = screen.getByTestId("focus-safe-scroll-target");

    setScrollMetrics(scrollTarget, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 240
    });
    scrollTarget.style.overflowY = "auto";
    fireEvent.scroll(scrollTarget);

    const toolbarObserverIndex = resizeObserverTargets.indexOf(toolbarRef.current as Element);

    for (const nextHeight of [165, 150, 133]) {
      toolbarHeight = nextHeight;
      act(() => resizeObserverCallbacks[toolbarObserverIndex]?.([], {} as ResizeObserver));
    }

    expect(scrollTarget.scrollTop).toBe(196);

    for (const nextHeight of [145, 160, 177]) {
      toolbarHeight = nextHeight;
      act(() => resizeObserverCallbacks[toolbarObserverIndex]?.([], {} as ResizeObserver));
    }

    expect(scrollTarget.scrollTop).toBe(240);
  });

  it("does not turn an ordinary collapse into a forced expand during header motion", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const toolbarRef = createRef<HTMLDivElement>();
    let metaHeight = 44;
    let surfaceHeight = 100;

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function readBounds(
      this: HTMLElement
    ) {
      if (this.dataset.chatSurface !== undefined) return { height: surfaceHeight } as DOMRect;
      if (this.hasAttribute("data-collapsible-session-meta")) return { height: metaHeight } as DOMRect;

      return { height: 0 } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function readScrollHeight(
      this: HTMLElement
    ) {
      return this.hasAttribute("data-collapsible-session-meta") ? 44 : 0;
    });

    render(getFocusSafeHeaderElement(toolbarRef, "live", "running", undefined, true));

    const scrollTarget = screen.getByTestId("focus-safe-scroll-target");

    setScrollMetrics(scrollTarget, { scrollTop: 48 });
    fireEvent.scroll(scrollTarget);
    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, { scrollTop: 72 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    const toolbarObserverIndex = resizeObserverTargets.indexOf(toolbarRef.current as Element);

    metaHeight = 22;
    surfaceHeight = 122;
    act(() => resizeObserverCallbacks[toolbarObserverIndex]?.([], {} as ResizeObserver));

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    metaHeight = 0;
    surfaceHeight = 144;
    act(() => resizeObserverCallbacks[toolbarObserverIndex]?.([], {} as ResizeObserver));

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
  });

  it("starts collapsed when text zoom leaves no usable mobile chat surface", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const toolbarRef = createRef<HTMLDivElement>();

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function readBounds(
      this: HTMLElement
    ) {
      if (this.dataset.chatSurface !== undefined) return { height: 60 } as DOMRect;

      return { height: 0 } as DOMRect;
    });

    render(getFocusSafeHeaderElement(toolbarRef, "live", "running", undefined, true));

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
    expect(getCollapsibleSessionMeta()).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the header expanded when the real mobile chat surface meets its minimum", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function readBounds(
      this: HTMLElement
    ) {
      if (this.dataset.chatSurface !== undefined) return { height: 72 } as DOMRect;

      return { height: 0 } as DOMRect;
    });
    const toolbarRef = createRef<HTMLDivElement>();

    render(getFocusSafeHeaderElement(toolbarRef, "live", "running", undefined, true));

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
  });

  it("automatically unlocks a forced header when the projected expanded surface fits", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const toolbarRef = createRef<HTMLDivElement>();
    let surfaceHeight = 60;

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function readBounds(
      this: HTMLElement
    ) {
      if (this.dataset.chatSurface !== undefined) return { height: surfaceHeight } as DOMRect;

      return { height: 0 } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function readScrollHeight(
      this: HTMLElement
    ) {
      return this.hasAttribute("data-collapsible-session-meta") ? 44 : 0;
    });

    render(getFocusSafeHeaderElement(toolbarRef, "live", "running", undefined, true));

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    const toolbarObserverIndex = resizeObserverTargets.indexOf(toolbarRef.current as Element);

    surfaceHeight = 200;
    act(() => resizeObserverCallbacks[toolbarObserverIndex]?.([], {} as ResizeObserver));

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
  });

  it("locks a normally collapsed header when the expanded surface later becomes constrained", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const toolbarRef = createRef<HTMLDivElement>();
    let surfaceHeight = 320;

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function readBounds(
      this: HTMLElement
    ) {
      if (this.dataset.chatSurface !== undefined) return { height: surfaceHeight } as DOMRect;

      return { height: 0 } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function readScrollHeight(
      this: HTMLElement
    ) {
      return this.hasAttribute("data-collapsible-session-meta") ? 44 : 0;
    });

    render(getFocusSafeHeaderElement(toolbarRef, "live", "running", undefined, true));

    const scrollTarget = screen.getByTestId("focus-safe-scroll-target");

    setScrollMetrics(scrollTarget, { scrollTop: 48 });
    fireEvent.scroll(scrollTarget);
    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, { scrollTop: 72 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    const toolbarObserverIndex = resizeObserverTargets.indexOf(toolbarRef.current as Element);

    surfaceHeight = 100;
    act(() => resizeObserverCallbacks[toolbarObserverIndex]?.([], {} as ResizeObserver));

    setScrollMetrics(scrollTarget, {
      clientHeight: 100,
      scrollHeight: 300,
      scrollTop: 200
    });

    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    surfaceHeight = 200;
    act(() => resizeObserverCallbacks[toolbarObserverIndex]?.([], {} as ResizeObserver));

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
  });

  it("retries constrained collapse after keyboard focus leaves session metadata", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    const toolbarRef = createRef<HTMLDivElement>();
    let surfaceHeight = 200;

    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function readBounds(
      this: HTMLElement
    ) {
      if (this.dataset.chatSurface !== undefined) return { height: surfaceHeight } as DOMRect;

      return { height: 0 } as DOMRect;
    });

    render(getFocusSafeHeaderElement(toolbarRef, "live", "running", undefined, true));

    const contextButton = screen.getByRole("button", { name: /Workspace: DeskCueWorkspace/u });
    const toolbarObserverIndex = resizeObserverTargets.indexOf(toolbarRef.current as Element);

    contextButton.focus();
    surfaceHeight = 60;
    act(() => resizeObserverCallbacks[toolbarObserverIndex]?.([], {} as ResizeObserver));

    expect(contextButton).toHaveFocus();
    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);

    act(() => screen.getByRole("button", { name: "More actions" }).focus());

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
  });

  it("releases invisible pointer focus before collapsing mobile metadata", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    const toolbarRef = createRef<HTMLDivElement>();

    render(getFocusSafeHeaderElement(toolbarRef));

    const scrollTarget = screen.getByTestId("focus-safe-scroll-target");
    const contextButton = screen.getByRole("button", { name: /Workspace: DeskCueWorkspace/u });

    fireEvent.pointerDown(contextButton, {
      clientX: 12,
      clientY: 12,
      pointerId: 1,
      pointerType: "touch"
    });

    contextButton.focus();
    fireEvent.pointerUp(contextButton, {
      clientX: 12,
      clientY: 12,
      pointerId: 1,
      pointerType: "touch"
    });

    expect(screen.queryByRole("dialog", { name: "Session context" })).toBeNull();

    fireEvent.pointerMove(contextButton, {
      clientX: 12,
      clientY: 40,
      pointerId: 1,
      pointerType: "touch"
    });

    setScrollMetrics(scrollTarget, { scrollTop: 48 });
    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, { scrollTop: 72 });
    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
    expect(contextButton).not.toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "Session context" })).toBeNull();
  });

  it("does not reuse a cancelled pointer gesture to blur later programmatic focus", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    const toolbarRef = createRef<HTMLDivElement>();

    render(getFocusSafeHeaderElement(toolbarRef));

    const scrollTarget = screen.getByTestId("focus-safe-scroll-target");
    const contextButton = screen.getByRole("button", { name: /Workspace: DeskCueWorkspace/u });

    fireEvent.pointerDown(contextButton, {
      pointerId: 1,
      pointerType: "touch"
    });
    fireEvent.pointerCancel(contextButton, {
      pointerId: 1,
      pointerType: "touch"
    });

    contextButton.focus();
    setScrollMetrics(scrollTarget, { scrollTop: 48 });
    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, { scrollTop: 72 });
    fireEvent.scroll(scrollTarget);

    expect(contextButton).toHaveFocus();
    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
  });

  it("keeps the header expanded near the bottom and reveals it at the end of chat", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
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
          onExitSession={vi.fn()}
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

  it("reveals the collapsed header when the next tab is not scrollable", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
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
          onExitSession={vi.fn()}
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

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("preserves the collapsed header when the next tab remains mid-scroll", () => {
    vi.stubGlobal("matchMedia", createMatchMediaController().matchMedia);
    const toolbarRef = createRef<HTMLDivElement>();
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
          onExitSession={vi.fn()}
          onSelectTab={vi.fn()}
        />
        <div data-testid="session-scroll-target" />
      </div>
    );
    const { rerender } = render(renderHeader("overview"));
    const scrollTarget = screen.getByTestId("session-scroll-target");

    setScrollMetrics(scrollTarget, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 48
    });

    fireEvent.wheel(scrollTarget, { deltaY: 24 });
    setScrollMetrics(scrollTarget, {
      clientHeight: 100,
      scrollHeight: 500,
      scrollTop: 72
    });

    fireEvent.scroll(scrollTarget);

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    rerender(renderHeader("diff"));

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
    expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("resets collapse and rebinds scrolling when compact height changes", () => {
    const media = createMatchMediaController();

    vi.stubGlobal("matchMedia", media.matchMedia);
    const toolbarRef = createRef<HTMLDivElement>();

    render(
      <div>
        <LiveSessionHeader
          activeTab="overview"
          actions={<button type="button">More actions</button>}
          adapterLabel="CODEX"
          contextCompactionCount={0}
          isAgentChat={false}
          liveUpdatesConnection={{
            lastSyncedAt: null,
            status: "live"
          }}
          navigationCapabilities={{
            changes: true,
            conversation: true,
            files: true,
            output: false,
            preview: true
          }}
          navigationIdPrefix="responsive-session"
          status="running"
          subtitle="D:\\work\\DeskCueWorkspace"
          title="Responsive session"
          toolbarRef={toolbarRef}
          onExitSession={vi.fn()}
          onSelectTab={vi.fn()}
        />
        <div data-testid="session-scroll-target" />
      </div>
    );

    const scrollTarget = screen.getByTestId("session-scroll-target");

    const collapseHeader = () => {
      setScrollMetrics(scrollTarget, { scrollTop: 48 });
      fireEvent.wheel(scrollTarget, { deltaY: 24 });
      setScrollMetrics(scrollTarget, { scrollTop: 72 });
      fireEvent.scroll(scrollTarget);
    };

    collapseHeader();
    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);

    act(() => media.setMatches(false));

    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);
    expect(getCollapsibleSessionMeta()).toHaveAttribute("aria-hidden", "false");

    collapseHeader();
    expect(toolbarRef.current).not.toHaveClass(styles.chatToolbarCollapsed);

    act(() => media.setMatches(true));
    collapseHeader();

    expect(toolbarRef.current).toHaveClass(styles.chatToolbarCollapsed);
  });
});
