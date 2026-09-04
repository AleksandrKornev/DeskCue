import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLogs: vi.fn()
}));

vi.mock("@api/endpoint/daemon/endpoints", () => ({
  daemonApi: {
    getLogs: mocks.getLogs
  }
}));

import { LogsPage } from "./LogsPage";

function logsResponse() {
  return {
    entries: [{
      context: { requestId: "request-1" },
      level: "info" as const,
      message: "HTTP request completed",
      timestamp: "2026-08-29T10:00:00.000Z"
    }],
    filePath: "C:\\DeskCue\\daemon.jsonl",
    truncated: false
  };
}

describe("LogsPage", () => {
  beforeEach(() => {
    mocks.getLogs.mockReset();
  });

  it("keeps pending load copy distinct from terminal empty state", async () => {
    let resolveLogs!: (value: ReturnType<typeof logsResponse>) => void;

    mocks.getLogs.mockReturnValueOnce(new Promise((resolve) => {
      resolveLogs = resolve;
    }));

    render(
      <MemoryRouter>
        <LogsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Loading log source...")).toBeInTheDocument();
    expect(screen.getByText("Loading system logs")).toBeInTheDocument();
    expect(screen.queryByText("File logging is disabled or no log file exists")).not.toBeInTheDocument();
    expect(screen.queryByText("No log entries loaded")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "System log entries" })).toHaveAttribute("aria-busy", "true");

    act(() => {
      resolveLogs(logsResponse());
    });

    expect(await screen.findByLabelText("C:\\DeskCue\\daemon.jsonl")).toBeInTheDocument();
    expect(screen.getByText("HTTP request completed")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "System log entries" })).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("list", { name: "Latest system log entries" }))
      .toContainElement(screen.getByRole("listitem", { name: "Log entry 1 of 1" }));
  });

  it("keeps live regions mounted and shows an accurate initial error state", async () => {
    mocks.getLogs.mockRejectedValueOnce(new Error("Daemon logs unavailable"));

    render(
      <MemoryRouter>
        <LogsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("Daemon logs unavailable")).toHaveAttribute("role", "alert");
    expect(screen.getByText("Log source unavailable")).toBeInTheDocument();
    expect(screen.getByText("Could not load system logs")).toBeInTheDocument();
    expect(screen.getByText("Check the daemon connection and try refreshing")).toBeInTheDocument();
    expect(screen.queryByText("File logging is disabled or no log file exists")).not.toBeInTheDocument();
    expect(screen.queryByText("No log entries loaded")).not.toBeInTheDocument();
  });

  it("uses time semantics only for valid timestamps", async () => {
    mocks.getLogs.mockResolvedValueOnce({
      ...logsResponse(),
      entries: [
        { context: null, level: "info", message: "Missing timestamp", timestamp: null },
        { context: null, level: "warn", message: "Invalid timestamp", timestamp: "not-a-date" },
        { context: null, level: "error", message: "Valid timestamp", timestamp: "2026-08-29T10:00:00.000Z" },
        { context: null, level: "info", message: "Parseable timestamp", timestamp: "August 29, 2026" }
      ]
    });

    render(
      <MemoryRouter>
        <LogsPage />
      </MemoryRouter>
    );

    await screen.findByText("Valid timestamp");

    expect(screen.getByText("no timestamp").tagName).toBe("SPAN");
    expect(screen.getByText("not-a-date").tagName).toBe("SPAN");
    expect(document.querySelectorAll("time")).toHaveLength(2);
    expect(screen.getByText("Valid timestamp").closest("article")?.querySelector("time"))
      .toHaveAttribute("datetime", "2026-08-29T10:00:00.000Z");
    expect(screen.getByText("Parseable timestamp").closest("article")?.querySelector("time"))
      .toHaveAttribute("datetime", new Date("August 29, 2026").toISOString());
  });

  it("keeps existing log row DOM anchors when a new tail entry arrives", async () => {
    const firstResponse = logsResponse();
    const nextResponse = {
      ...firstResponse,
      entries: [
        ...firstResponse.entries,
        {
          context: { requestId: "request-2" },
          level: "warn" as const,
          message: "New log entry",
          timestamp: "2026-08-29T10:00:01.000Z"
        }
      ]
    };

    mocks.getLogs
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(nextResponse);

    render(
      <MemoryRouter>
        <LogsPage />
      </MemoryRouter>
    );

    const originalMessage = await screen.findByText("HTTP request completed");
    const originalRow = originalMessage.closest("article");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("New log entry");

    expect(screen.getByText("HTTP request completed").closest("article")).toBe(originalRow);
  });

  it("keeps the full log path accessible while shortening a deep visible path", async () => {
    const filePath = "D:\\work\\DeskCue\\.deskcue-data\\service\\logs\\daemon.jsonl";

    mocks.getLogs.mockResolvedValueOnce({ ...logsResponse(), filePath });

    render(
      <MemoryRouter>
        <LogsPage />
      </MemoryRouter>
    );

    const sourcePath = await screen.findByLabelText(filePath);

    expect(sourcePath).toHaveTextContent(filePath);
    expect(sourcePath.querySelector('[aria-hidden="true"]'))
      .toHaveTextContent("…\\logs\\daemon.jsonl");
    expect(sourcePath).not.toHaveAttribute("title");
  });
});
