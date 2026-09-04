import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConversationActivity } from "@modules/session/types";

import { ChatInlineActivityFeed } from "./ChatInlineActivityFeed";
import { ChatMessageActivityChip } from "./ChatMessageActivityChip";

const activity: ConversationActivity = {
  entries: [],
  id: "tools:source-10",
  kind: "tools",
  label: "Tools (3)",
  timestamp: "2026-09-02T12:00:00.000Z"
};

describe("ChatMessageActivityChip", () => {
  it("connects an attached activity chip to its expanded region", () => {
    render(
      <>
        <ChatMessageActivityChip
          activity={activity}
          isExpanded
          messageEntryId="assistant:source-20"
          onToggle={vi.fn()}
        />
        <ChatInlineActivityFeed
          activities={[activity]}
          isActivityExpanded={() => true}
          messageEntryId="assistant:source-20"
          onHydrateActivity={vi.fn()}
          renderActivityEntries={() => <p>Tool output</p>}
        />
      </>
    );

    const toggle = screen.getByRole("button", { name: /tools/i });
    const region = screen.getByRole("region", { name: /tools/i });

    expect(toggle).toHaveAttribute("aria-controls", region.id);
    expect(region).toHaveAttribute("aria-labelledby", toggle.id);
  });

  it("does not reference an absent region while the activity is collapsed", () => {
    render(
      <>
        <ChatMessageActivityChip
          activity={activity}
          isExpanded={false}
          messageEntryId="assistant:source-20"
          onToggle={vi.fn()}
        />
        <ChatInlineActivityFeed
          activities={[activity]}
          isActivityExpanded={() => false}
          messageEntryId="assistant:source-20"
          onHydrateActivity={vi.fn()}
          renderActivityEntries={() => <p>Tool output</p>}
        />
      </>
    );

    expect(screen.getByRole("button", { name: /tools/i })).not.toHaveAttribute("aria-controls");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
