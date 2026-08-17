import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalLlmActionRequestCard } from "./LocalLlmActionRequestCard";
import { LocalLlmAgentModePanel } from "./LocalLlmAgentModePanel";
import { LocalLlmChangeEvidenceLabel } from "./LocalLlmChangeEvidenceLabel";

describe("local LLM agent-mode UI", () => {
  it("describes full access without implying a permission prompt", () => {
    render(
      <LocalLlmAgentModePanel
        capabilities={{
          changesEnabled: true,
          mode: "full_access",
          toolsEnabled: true,
          workspaceName: "DeskCue"
        }}
      />
    );

    expect(screen.getByText("Full access")).toBeInTheDocument();
    expect(screen.getByText("DeskCue")).toBeInTheDocument();
    expect(screen.getByText("Recorded here")).toBeInTheDocument();
    expect(screen.getByText(/trusted machine with no sandbox/i)).toBeInTheDocument();
  });

  it("offers decision controls only for a pending ask-mode action", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const request = {
      actionLabel: "Run command",
      description: "The model wants to run the workspace test command.",
      id: "request-1",
      scope: "npm run test",
      status: "pending" as const,
      title: "Run tests"
    };
    const { rerender } = render(
      <LocalLlmActionRequestCard request={request} onApprove={onApprove} onReject={onReject} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Run command" }));
    expect(onApprove).toHaveBeenCalledWith("request-1");

    rerender(
      <LocalLlmActionRequestCard
        request={{ ...request, status: "executed" }}
        onApprove={onApprove}
        onReject={onReject}
      />
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("keeps proposed, applied, and observed changes visually honest", () => {
    const { rerender } = render(
      <LocalLlmChangeEvidenceLabel evidence={{ fileCount: 2, kind: "proposed" }} />
    );

    expect(screen.getByText("Proposed changes")).toBeInTheDocument();
    expect(screen.getByText(/files are unchanged/i)).toBeInTheDocument();

    rerender(<LocalLlmChangeEvidenceLabel evidence={{ fileCount: 1, kind: "applied" }} />);
    expect(screen.getByText("Applied changes")).toBeInTheDocument();
    expect(screen.getByText(/changed by this turn/i)).toBeInTheDocument();

    rerender(<LocalLlmChangeEvidenceLabel evidence={{ fileCount: 3, kind: "observed" }} />);
    expect(screen.getByText("Observed workspace activity")).toBeInTheDocument();
    expect(screen.getByText(/source is not confirmed/i)).toBeInTheDocument();
  });
});
