import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentSessionsPanelSurface } from "./AgentSessionsPanelSurface";

describe("AgentSessionsPanelSurface", () => {
  it("shows the browser context and actions while browsing chats", () => {
    render(
      <AgentSessionsPanelSurface action={<button type="button">New chat</button>}>
        <div>Chat list</div>
      </AgentSessionsPanelSurface>
    );

    expect(screen.getByRole("heading", { name: "Control room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
  });

  it("removes browser-only chrome from a focused mobile detail", () => {
    render(
      <AgentSessionsPanelSurface
        action={<button type="button">New chat</button>}
        focusedDetail
      >
        <div>Selected transcript</div>
      </AgentSessionsPanelSurface>
    );

    expect(screen.getByText("Selected transcript")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Control room" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
  });
});
