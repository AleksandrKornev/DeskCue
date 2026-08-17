import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  AccessDeviceSummary,
  CurrentAccessState
} from "@deskcue/protocol";

import { AccessDeviceList } from "./AccessDeviceList";
import type { AccessDeviceListProps } from "./types";

const currentAccess: CurrentAccessState = {
  authRequired: true,
  credentialPresented: true,
  deviceId: "device-current",
  trustedHost: false
};

function createDevice(
  id: string,
  overrides: Partial<AccessDeviceSummary> = {}
): AccessDeviceSummary {
  return {
    createdAt: "2026-07-17T10:00:00.000Z",
    current: false,
    id,
    label: id,
    lastIp: "127.0.0.1",
    lastSeenAt: "2026-07-17T10:05:00.000Z",
    revokedAt: null,
    userAgent: "Chrome",
    ...overrides
  };
}

function renderDeviceList(overrides: Partial<AccessDeviceListProps> = {}) {
  const props: AccessDeviceListProps = {
    currentAccess,
    devices: [
      createDevice("device-current", { current: true, label: "Current browser" }),
      createDevice("device-other", { label: "Phone" })
    ],
    forgettingCurrentBrowser: false,
    loading: false,
    renamingDeviceId: null,
    resettingOtherTokens: false,
    revokingDeviceId: null,
    onForgetCurrentBrowser: vi.fn(),
    onRenameDevice: vi.fn(() => Promise.resolve(true)),
    onRevokeDevice: vi.fn(),
    onRevokeOtherDevices: vi.fn(),
    ...overrides
  };

  render(<AccessDeviceList {...props} />);

  return props;
}

describe("AccessDeviceList", () => {
  it("renders current device and grouped other active tokens", () => {
    renderDeviceList();

    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText(/Current browser/)).toBeInTheDocument();
    expect(screen.getByText("Other active tokens")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open tokens/i })).toBeInTheDocument();
  });

  it("expands grouped token rows and can revoke a token", () => {
    const props = renderDeviceList();

    fireEvent.click(screen.getByRole("button", { name: /Open tokens/i }));
    const phoneRow = screen.getByText("Phone").closest("li");

    expect(phoneRow).not.toBeNull();
    fireEvent.click(within(phoneRow as HTMLElement).getByRole("button", { name: "Revoke" }));

    expect(props.onRevokeDevice).toHaveBeenCalledWith(
      expect.objectContaining({ id: "device-other" })
    );
  });

  it("falls back to host access copy when there is no current device token", () => {
    renderDeviceList({
      currentAccess: {
        authRequired: false,
        credentialPresented: false,
        deviceId: null,
        trustedHost: true
      },
      devices: []
    });

    expect(screen.getByText("Host access")).toBeInTheDocument();
    expect(screen.getByText(/not using a device token/i)).toBeInTheDocument();
  });
});
