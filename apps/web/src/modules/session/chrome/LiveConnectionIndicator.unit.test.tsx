import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLiveConnectionCopy } from "./helpers";
import {
  LiveConnectionAnnouncement,
  LiveConnectionIndicator
} from "./LiveConnectionIndicator";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LiveConnectionIndicator", () => {
  it("keeps every freshness tooltip branch concise and free of terminal punctuation", () => {
    const now = new Date("2026-07-17T10:00:15.000Z").getTime();
    const lastSyncedAt = "2026-07-17T10:00:00.000Z";
    const tooltipLabels = [
      getLiveConnectionCopy({ lastSyncedAt, status: "live" }, now).tooltipLabel,
      getLiveConnectionCopy({ lastSyncedAt: null, status: "live" }, now).tooltipLabel,
      getLiveConnectionCopy({ lastSyncedAt, status: "connecting" }, now).tooltipLabel,
      getLiveConnectionCopy({ lastSyncedAt: null, status: "connecting" }, now).tooltipLabel,
      getLiveConnectionCopy({ lastSyncedAt, status: "reconnecting" }, now).tooltipLabel,
      getLiveConnectionCopy({ lastSyncedAt: null, status: "reconnecting" }, now).tooltipLabel,
      getLiveConnectionCopy({ lastSyncedAt, status: "offline" }, now).tooltipLabel,
      getLiveConnectionCopy({ lastSyncedAt: null, status: "offline" }, now).tooltipLabel
    ];

    expect(tooltipLabels).toEqual([
      "Updated 15s ago",
      "No update received yet",
      "Last update 15s ago",
      "Opening live updates",
      "Last update 15s ago",
      "No update received yet",
      "Last update 15s ago",
      "No update received yet"
    ]);
  });

  it("renders live status with a recent update age", () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-17T10:00:15.000Z").getTime());

    const { rerender } = render(
      <>
        <LiveConnectionAnnouncement
          connection={{
            lastSyncedAt: "2026-07-17T10:00:00.000Z",
            status: "live"
          }}
        />
        <LiveConnectionIndicator
          connection={{
            lastSyncedAt: "2026-07-17T10:00:00.000Z",
            status: "live"
          }}
        />
      </>
    );

    const indicator = screen.getByRole("button");

    expect(indicator).toHaveAttribute(
      "aria-label",
      "Live updates connected"
    );

    fireEvent.focus(indicator);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Updated 15s ago");
    fireEvent.blur(indicator);

    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Updated 15s ago")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Live updates connected");

    rerender(
      <>
        <LiveConnectionAnnouncement
          connection={{
            lastSyncedAt: "2026-07-17T10:00:00.000Z",
            status: "reconnecting"
          }}
        />
        <LiveConnectionIndicator
          connection={{
            lastSyncedAt: "2026-07-17T10:00:00.000Z",
            status: "reconnecting"
          }}
        />
      </>
    );

    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Live updates reconnecting"
    );

    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Reconnecting · Last update 15s ago"
    );

    expect(screen.getByRole("status")).toHaveTextContent("Live updates reconnecting");
  });

  it("renders connecting status when no sync has landed yet", () => {
    render(
      <>
        <LiveConnectionAnnouncement
          connection={{
            lastSyncedAt: null,
            status: "connecting"
          }}
        />
        <LiveConnectionIndicator
          connection={{
            lastSyncedAt: null,
            status: "connecting"
          }}
        />
      </>
    );

    expect(screen.getAllByText("Connecting")).not.toHaveLength(0);
    expect(screen.getByText("opening live updates")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Connecting live updates"
    );

    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Connecting · Opening live updates"
    );

    expect(screen.getByRole("status")).toHaveTextContent("Connecting live updates");
  });

  it("describes an offline updates channel without claiming the host is offline", () => {
    render(
      <>
        <LiveConnectionAnnouncement
          connection={{
            lastSyncedAt: null,
            status: "offline"
          }}
        />
        <LiveConnectionIndicator
          connection={{
            lastSyncedAt: null,
            status: "offline"
          }}
        />
      </>
    );

    expect(screen.getAllByText("Updates offline")).not.toHaveLength(0);
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "Live updates offline"
    );

    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Updates offline · No update received yet"
    );

    expect(screen.getByRole("status")).toHaveTextContent("Live updates offline");
    expect(screen.queryByText("Host offline")).not.toBeInTheDocument();
  });
});
