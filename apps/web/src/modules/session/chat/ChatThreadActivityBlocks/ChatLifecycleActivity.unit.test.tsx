import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ConversationActivity } from "@modules/session/types";

import { ChatLifecycleActivity } from "./ChatLifecycleActivity";

function createContextActivity(detail: string): ConversationActivity {
  return {
    entries: [{
      id: "context-entry",
      parts: [{ detail, label: "Context compressed", type: "status" }],
      phase: "context_compacted",
      role: "system",
      text: detail,
      timestamp: "2026-09-02T06:58:00.000Z"
    }],
    id: "context-1",
    kind: "context",
    label: "Context compressed",
    timestamp: "2026-09-02T06:58:00.000Z"
  };
}

function createModelActivity(detail: string): ConversationActivity {
  return {
    ...createContextActivity(detail),
    id: "model-1",
    kind: "model",
    label: "Model changed"
  };
}

describe("ChatLifecycleActivity", () => {
  it("does not leave sentence punctuation stranded before the timestamp", () => {
    render(
      <ChatLifecycleActivity
        activity={createContextActivity(
          "Codex summarized 67 earlier messages to keep the conversation going."
        )}
      />
    );

    expect(screen.getByText(/Codex summarized 67 earlier messages/u))
      .toHaveTextContent("Codex summarized 67 earlier messages to keep the conversation going");
    expect(screen.queryByText(/going\.$/u)).not.toBeInTheDocument();
  });

  it("preserves ellipses and punctuation outside context-compaction events", () => {
    const { rerender } = render(
      <ChatLifecycleActivity activity={createContextActivity("Waiting...")} />
    );

    expect(screen.getByText("Waiting...")).toBeInTheDocument();

    rerender(<ChatLifecycleActivity activity={createModelActivity("Changed successfully.")} />);

    expect(screen.getByText("Changed successfully.")).toBeInTheDocument();
  });
});
