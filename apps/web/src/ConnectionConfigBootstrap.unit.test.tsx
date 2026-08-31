import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareConnectionConfig: vi.fn(() => new Promise<void>(() => {})),
  readAppPath: vi.fn((pathname: string) => pathname.replace(/^\/+|\/+$/g, "")
    ? `/${pathname.replace(/^\/+|\/+$/g, "")}`
    : "/")
}));

vi.mock("@api/connection/pairing", () => ({
  prepareConnectionConfig: mocks.prepareConnectionConfig
}));

vi.mock("@runtime", () => ({
  useDeskCueRuntime: () => ({ readAppPath: mocks.readAppPath })
}));

vi.mock("./App", () => ({
  default: () => <div>DeskCue app</div>
}));

import { ConnectionConfigBootstrap } from "./ConnectionConfigBootstrap";

describe("ConnectionConfigBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies a slash-only bootstrap location from its runtime-relative path", () => {
    render(
      <MemoryRouter initialEntries={["///?agent=session-1"]}>
        <ConnectionConfigBootstrap />
      </MemoryRouter>
    );

    expect(mocks.readAppPath).toHaveBeenCalledWith("///");
    expect(screen.getByRole("status"))
      .toHaveAccessibleName("Loading source-agent chat");
  });
});
