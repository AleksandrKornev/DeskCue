import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionDetail, SessionStatus } from "@deskcue/protocol";

import { ManualSessionOverview } from "./ManualSessionOverview";

function createSession(status: SessionStatus, logs: SessionDetail["logs"] = []) {
  return {
    git: {
      changedFiles: [],
      isGitRepo: true
    },
    logs,
    sourceSessionId: null,
    status
  } as unknown as SessionDetail;
}

describe("ManualSessionOverview", () => {
  it("keeps active waiting copy for a running command without output", () => {
    render(<ManualSessionOverview activeSelectedSession={createSession("running")} />);

    expect(screen.getByText("Waiting for output...")).toBeInTheDocument();
  });

  it.each([
    ["done", "Command completed. Open Output to inspect the full log."],
    ["failed", "Command failed. Open Output to inspect the full log."],
    ["stopped", "Command stopped. Open Output to inspect the full log."]
  ] satisfies Array<[SessionStatus, string]>)(
    "renders terminal truth for a %s command without hydrated logs",
    (status, expected) => {
      render(<ManualSessionOverview activeSelectedSession={createSession(status)} />);

      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.queryByText("Waiting for output...")).not.toBeInTheDocument();
    }
  );

  it("renders available output instead of the terminal fallback", () => {
    render(<ManualSessionOverview activeSelectedSession={createSession("done", [{
      id: "log-1",
      stream: "stdout",
      text: "DQ007-DONE-OUTPUT\n",
      timestamp: "2026-08-22T08:00:00.000Z"
    }])} />);

    expect(screen.getByText("[stdout] DQ007-DONE-OUTPUT")).toBeInTheDocument();
    expect(screen.queryByText(/Open Output to inspect/)).not.toBeInTheDocument();
  });
});
