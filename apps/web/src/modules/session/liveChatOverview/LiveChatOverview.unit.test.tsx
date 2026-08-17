import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "@deskcue/protocol";
import type { ManagedSessionChatThreadProps } from "@modules/session/chat";

import { LiveChatOverview } from "./LiveChatOverview";
import styles from "./styles.module.scss";

vi.mock("@modules/session/chat", () => ({
  ManagedSessionChatThread: () => <div data-testid="chat-thread" />
}));

vi.mock("@modules/session/composer", () => ({
  SessionMessageComposer: () => <div data-testid="chat-composer" />
}));

function renderOverview(layoutMode?: "embedded" | "viewport") {
  return render(
    <LiveChatOverview
      activeSelectedSession={null}
      activeTab="overview"
      chatComposerShellRef={createRef<HTMLDivElement>()}
      chatSurfaceRef={createRef<HTMLDivElement>()}
      chatWorkspaceStyle={undefined}
      composerProps={{
        activePromptText: null,
        actionRequest: null,
        canSendInput: true,
        isPromptInFlight: false,
        isPromptQueued: false,
        onInterruptPrompt: vi.fn(),
        onSendInput: vi.fn().mockResolvedValue(true),
        sharedSessionHint: null
      }}
      isCompactViewport={false}
      isInterruptingPrompt={false}
      layoutMode={layoutMode}
      liveUpdatesConnection={{ lastSyncedAt: null, status: "live" }}
      sessionShell={{ id: "session-1" } as SessionSummary}
      sharedViewerCount={1}
      threadProps={{} as ManagedSessionChatThreadProps}
    />
  );
}

describe("LiveChatOverview layout mode", () => {
  it("owns embedded positioning through its component class", () => {
    const { container } = renderOverview("embedded");

    expect(container.firstElementChild).toHaveClass(styles.chatWorkspaceEmbedded);
    expect(screen.getByTestId("chat-composer").parentElement).toHaveClass(styles.chatComposerContent);
  });

  it("keeps standalone viewport positioning as the default layout", () => {
    const { container } = renderOverview();

    expect(container.firstElementChild).not.toHaveClass(styles.chatWorkspaceEmbedded);
  });
});
