import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RouteLoadingShell } from "./RouteLoadingShell";

describe("RouteLoadingShell", () => {
  it("announces a generic page load while keeping the shell busy", () => {
    render(<RouteLoadingShell pathname="/settings" search="" />);

    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading DeskCue page");
  });

  it("announces dashboard loading with route-specific copy", () => {
    render(<RouteLoadingShell pathname="/" search="" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading DeskCue dashboard");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("uses dashboard loading when the first agent query value is empty", () => {
    render(<RouteLoadingShell pathname="/" search="?agent=&agent=session-1" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading DeskCue dashboard");
  });

  it("uses the session skeleton as the only live status for session routes", () => {
    render(<RouteLoadingShell pathname="/sessions/session-1" search="" />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading source-agent chat");
  });

  it("uses the session shell for the preview tab route", () => {
    render(<RouteLoadingShell pathname="/sessions/session-1/preview" search="" />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Loading source-agent chat");
  });

  it("uses the session shell when React Router decodes the preview tab", () => {
    render(<RouteLoadingShell pathname="/sessions/session-1/%70review" search="" />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Loading source-agent chat");
  });

  it("matches session routes with the same case-insensitivity as React Router", () => {
    render(<RouteLoadingShell pathname="/SESSIONS/session-1/Preview" search="" />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Loading source-agent chat");
  });

  it.each([
    "/s%65ssions/session-1",
    "/%73essions/session-1/preview"
  ])("matches React Router session routes with an encoded static segment: %s", (pathname) => {
    render(<RouteLoadingShell pathname={pathname} search="" />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Loading source-agent chat");
  });

  it("keeps an encoded slash inside the session id as one route segment", () => {
    render(<RouteLoadingShell pathname="/sessions/id%2Fpreview%2Fextra" search="" />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Loading source-agent chat");
  });

  it.each([
    "/sessions/session-1//",
    "/sessions/session-1/chat//"
  ])("matches React Router session routes with repeated trailing slashes: %s", (pathname) => {
    render(<RouteLoadingShell pathname={pathname} search="" />);

    expect(screen.getByRole("status")).toHaveAccessibleName("Loading source-agent chat");
  });

  it("does not treat an overlong stale session route as a session", () => {
    render(<RouteLoadingShell pathname="/sessions/session-1/chat/extra" search="" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading DeskCue page");
  });
});
