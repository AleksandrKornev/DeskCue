import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import styles from "@modules/session/chat/styles.module.scss";
import type { ConversationActivity } from "@modules/session/types";

import { ChatInlineActivityItem } from "./ChatInlineActivityItem";

function createActivity(): ConversationActivity {
  return {
    entries: [],
    id: "tools-1",
    kind: "tools",
    label: "Tools (3)",
    timestamp: "2026-08-07T10:00:00.000Z"
  };
}

describe("ChatInlineActivityItem", () => {
  it("connects the disclosure button with its expanded region", () => {
    render(
      <ChatInlineActivityItem
        activity={createActivity()}
        isExpanded
        onHydrate={vi.fn()}
        onToggle={vi.fn()}
        renderActivityEntries={() => <p>Tool output</p>}
      />
    );

    const toggle = screen.getByRole("button", { name: /tools/i });
    const region = screen.getByRole("region", { name: /tools/i });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", region.id);
    expect(region).toHaveAttribute("aria-labelledby", toggle.id);
  });

  it("does not mount the activity region while collapsed", () => {
    render(
      <ChatInlineActivityItem
        activity={createActivity()}
        isExpanded={false}
        onHydrate={vi.fn()}
        onToggle={vi.fn()}
        renderActivityEntries={() => <p>Tool output</p>}
      />
    );

    expect(screen.getByRole("button", { name: /tools/i })).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("keeps an unbroken activity label in a shrinkable wrapping slot", () => {
    const activity = createActivity();

    activity.label = "tool/" + "very-long-unbroken-segment".repeat(12);

    const { container } = render(
      <ChatInlineActivityItem
        activity={activity}
        isExpanded={false}
        onHydrate={vi.fn()}
        onToggle={vi.fn()}
        renderActivityEntries={() => null}
      />
    );

    expect(container.querySelector(`.${styles.chatInlineActivityLabelText}`))
      .toHaveTextContent(activity.label);
  });

  it("uses a bounded scroll region only when it owns Activity scrolling", () => {
    const { rerender } = render(
      <ChatInlineActivityItem
        activity={createActivity()}
        isExpanded
        onHydrate={vi.fn()}
        onToggle={vi.fn()}
        renderActivityEntries={() => <p>Tool output</p>}
      />
    );

    expect(screen.getByRole("region")).not.toHaveClass(
      styles.chatInlineActivityContentScrollOwner
    );

    rerender(
      <ChatInlineActivityItem
        activity={createActivity()}
        isExpanded
        scrollExpandedContent
        onHydrate={vi.fn()}
        onToggle={vi.fn()}
        renderActivityEntries={() => <p>Tool output</p>}
      />
    );

    expect(screen.getByRole("region")).toHaveClass(
      styles.chatInlineActivityContentScrollOwner
    );
  });
});
