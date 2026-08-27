import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cloudMocks = vi.hoisted(() => ({
  error: null as string | null,
  loading: false,
  status: null as Record<string, unknown> | null
}));

vi.mock("@modules/cloudConnection/model/useCloudConnectionStatus", () => ({
  useCloudConnectionStatus: () => ({
    error: cloudMocks.error,
    loading: cloudMocks.loading,
    status: cloudMocks.status
  })
}));

import { CloudConnectionAffordance } from "./CloudConnectionAffordance";

describe("CloudConnectionAffordance", () => {
  beforeEach(() => {
    cloudMocks.error = null;
    cloudMocks.loading = false;
    cloudMocks.status = null;
  });

  it("shows local-only state and opens the Connections settings owner", () => {
    cloudMocks.status = {
      connected: false,
      enabled: false,
      state: "disconnected"
    };

    render(
      <MemoryRouter>
        <CloudConnectionAffordance />
      </MemoryRouter>
    );

    const link = screen.getByRole("link", {
      name: "DeskCue local only; open Connections settings"
    });

    expect(link).toHaveTextContent("Local only");
    expect(link).toHaveAttribute("href", "/settings?tab=access");
  });

  it("keeps authoritative disabled state local-only despite stale connector state", () => {
    cloudMocks.status = {
      connected: false,
      enabled: false,
      state: "revoked"
    };

    render(
      <MemoryRouter>
        <CloudConnectionAffordance />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", {
      name: "DeskCue local only; open Connections settings"
    })).toBeInTheDocument();
    expect(screen.queryByText("Cloud access revoked")).not.toBeInTheDocument();
  });

  it("does not present an unresolved initial request as local-only", () => {
    cloudMocks.loading = true;
    render(
      <MemoryRouter>
        <CloudConnectionAffordance />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", {
      name: "DeskCue checking cloud; open Connections settings"
    })).toBeInTheDocument();
    expect(screen.queryByText("Local only")).not.toBeInTheDocument();
  });

  it("does not present an unavailable status response as local-only", () => {
    render(
      <MemoryRouter>
        <CloudConnectionAffordance />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", {
      name: "DeskCue cloud status unavailable; open Connections settings"
    })).toBeInTheDocument();
    expect(screen.queryByText("Local only")).not.toBeInTheDocument();
  });

  it("does not keep presenting a stale successful status after refresh failure", () => {
    cloudMocks.error = "Fixture refresh failure";
    cloudMocks.status = {
      connected: true,
      enabled: true,
      state: "connected"
    };

    render(
      <MemoryRouter>
        <CloudConnectionAffordance />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", {
      name: "DeskCue cloud status unavailable; open Connections settings"
    })).toBeInTheDocument();
    expect(screen.queryByText("Cloud connected")).not.toBeInTheDocument();
  });

  it("keeps a reconnecting label in the compact header", () => {
    cloudMocks.status = {
      connected: false,
      enabled: true,
      state: "disconnected"
    };

    render(
      <MemoryRouter>
        <CloudConnectionAffordance />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", {
      name: "DeskCue cloud reconnecting; open Connections settings"
    })).toBeInTheDocument();
    expect(screen.getByText("Cloud reconnecting")).toBeInTheDocument();
    expect(screen.getByText("Retrying")).toBeInTheDocument();
  });

  it("does not present revoked Cloud access as reconnecting", () => {
    cloudMocks.status = {
      connected: false,
      enabled: true,
      state: "revoked"
    };

    render(
      <MemoryRouter>
        <CloudConnectionAffordance />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", {
      name: "DeskCue cloud access revoked; open Connections settings"
    })).toBeInTheDocument();
    expect(screen.getByText("Cloud access revoked")).toBeInTheDocument();
    expect(screen.queryByText("Cloud reconnecting")).not.toBeInTheDocument();
  });
});
