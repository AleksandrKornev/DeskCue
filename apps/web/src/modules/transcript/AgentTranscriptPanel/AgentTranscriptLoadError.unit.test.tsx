import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentTranscriptLoadError } from "./AgentTranscriptLoadError";

describe("AgentTranscriptLoadError", () => {
  it("announces the local failure and offers a retry", () => {
    render(
      <AgentTranscriptLoadError
        errorMessage="DeskCue couldn't load this local transcript."
        isRetrying={false}
        onFocusOwnershipChange={() => undefined}
        onRetry={() => undefined}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load chat");
    expect(screen.getByRole("button", { name: "Retry" })).toHaveAttribute(
      "aria-disabled",
      "false"
    );
  });

  it("preserves focus ownership while starting a retry", () => {
    const onFocusOwnershipChange = vi.fn();
    const onRetry = vi.fn();

    render(
      <AgentTranscriptLoadError
        errorMessage="DeskCue couldn't load this local transcript."
        isRetrying={false}
        onFocusOwnershipChange={onFocusOwnershipChange}
        onRetry={onRetry}
      />
    );

    const retryButton = screen.getByRole("button", { name: "Retry" });

    retryButton.focus();

    fireEvent.click(retryButton);

    expect(onFocusOwnershipChange).toHaveBeenCalledWith(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the pending retry focusable without dispatching twice", () => {
    const onRetry = vi.fn();

    render(
      <AgentTranscriptLoadError
        errorMessage="DeskCue couldn't load this local transcript."
        isRetrying
        onFocusOwnershipChange={() => undefined}
        onRetry={onRetry}
      />
    );

    const retryButton = screen.getByRole("button", { name: "Retrying…" });

    expect(retryButton).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(retryButton);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
