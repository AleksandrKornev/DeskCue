import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    connectionRevision: 0,
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

  const view = render(
    <main>
      <AccessDeviceList {...props} />
    </main>
  );

  return { props, ...view };
}

describe("AccessDeviceList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders current device and grouped other active tokens", () => {
    renderDeviceList();

    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText(/Current browser/)).toBeInTheDocument();
    expect(screen.getByText("Other active tokens")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open tokens/i })).toBeInTheDocument();
  });

  it("expands grouped token rows and can revoke a token", () => {
    const { props } = renderDeviceList();

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

  it("keeps focus on the stable group visibility control", () => {
    renderDeviceList({
      devices: [
        createDevice("device-current", { current: true, label: "Current browser" }),
        ...Array.from({ length: 6 }, (_, index) => createDevice(`device-${index}`, {
          label: `Browser ${index}`,
          lastIp: `192.168.1.${index + 10}`
        }))
      ]
    });

    const showAllButton = screen.getByRole("button", { name: "Show all groups" });

    showAllButton.focus();
    fireEvent.click(showAllButton);

    const showFewerButton = screen.getByRole("button", { name: "Show fewer groups" });

    expect(showFewerButton).toBe(showAllButton);
    expect(showFewerButton).toHaveFocus();
    expect(showFewerButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("All 6 active token groups shown")).toBeInTheDocument();

    fireEvent.click(showFewerButton);

    expect(screen.getByRole("button", { name: "Show all groups" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Show all groups" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("hands focus to the last group when the visibility control disappears", () => {
    const fiveDevices = Array.from({ length: 5 }, (_, index) => createDevice(`device-${index}`, {
      label: `Browser ${index}`,
      lastIp: `192.168.1.${index + 10}`
    }));
    const { props, rerender } = renderDeviceList({ devices: fiveDevices });
    const showAllButton = screen.getByRole("button", { name: "Show all groups" });

    showAllButton.focus();
    fireEvent.click(showAllButton);
    rerender(
      <main>
        <AccessDeviceList {...props} devices={fiveDevices.slice(0, 4)} />
      </main>
    );

    expect(screen.getByRole("button", { name: /Browser 3.*Open tokens/i })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /Show (all|fewer) groups/ })).not.toBeInTheDocument();

    rerender(
      <main>
        <AccessDeviceList {...props} devices={fiveDevices} />
      </main>
    );

    expect(screen.getByRole("button", { name: "Show all groups" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("rechecks focused footer visibility after device groups change", () => {
    const sixDevices = Array.from({ length: 6 }, (_, index) => createDevice(`device-${index}`, {
      label: `Browser ${index}`,
      lastIp: `192.168.1.${index + 10}`
    }));
    const { props, rerender } = renderDeviceList({ devices: sixDevices });
    const showAllButton = screen.getByRole("button", { name: "Show all groups" });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);

    vi.stubGlobal("innerHeight", 568);

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);

      return 1;
    });

    Object.defineProperty(showAllButton, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 700, top: 656 })
    });

    showAllButton.focus();
    rerender(
      <main>
        <AccessDeviceList
          {...props}
          devices={[
            ...sixDevices,
            createDevice("device-6", { label: "Browser 6", lastIp: "192.168.1.16" })
          ]}
        />
      </main>
    );

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "auto", top: 144 });
  });

  it("keeps the focused disclosure mounted while retained devices refresh", () => {
    const devices = Array.from({ length: 5 }, (_, index) => createDevice(`device-${index}`, {
      label: `Browser ${index}`,
      lastIp: `192.168.1.${index + 10}`
    }));
    const { props, rerender } = renderDeviceList({ devices });
    const showAllButton = screen.getByRole("button", { name: "Show all groups" });

    showAllButton.focus();
    rerender(
      <main>
        <AccessDeviceList {...props} devices={devices} loading />
      </main>
    );

    expect(screen.getByRole("status")).toHaveTextContent("Refreshing active tokens...");
    expect(screen.getByRole("button", { name: "Show all groups" })).toBe(showAllButton);
    expect(showAllButton).toHaveFocus();

    rerender(
      <main>
        <AccessDeviceList {...props} devices={devices} loading={false} />
      </main>
    );

    expect(showAllButton).toHaveFocus();
  });

  it("rechecks focused footer visibility after same-device content changes", () => {
    const devices = Array.from({ length: 5 }, (_, index) => createDevice(`device-${index}`, {
      label: `Browser ${index}`,
      lastIp: `192.168.1.${index + 10}`
    }));
    const { props, rerender } = renderDeviceList({ devices });
    const showAllButton = screen.getByRole("button", { name: "Show all groups" });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);

    vi.stubGlobal("innerHeight", 568);

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);

      return 1;
    });

    Object.defineProperty(showAllButton, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ bottom: 700, top: 656 })
    });

    showAllButton.focus();
    rerender(
      <main>
        <AccessDeviceList
          {...props}
          devices={devices.map((device, index) => index === 0
            ? { ...device, lastSeenAt: "2026-08-30T13:59:00.000Z" }
            : device)}
        />
      </main>
    );

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "auto", top: 144 });
  });

  it("clears local rename state when the connection changes", () => {
    const device = createDevice("device-other", { label: "Phone" });
    const { props, rerender } = renderDeviceList({ devices: [device] });

    fireEvent.click(screen.getByRole("button", { name: /Open tokens/i }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Stale phone name" } });

    rerender(
      <main>
        <AccessDeviceList {...props} connectionRevision={1} devices={[]} />
      </main>
    );

    rerender(
      <main>
        <AccessDeviceList {...props} connectionRevision={1} devices={[device]} />
      </main>
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open tokens/i }));
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
  });

  it("gives an empty-list focus fallback a visible-focus styling hook", () => {
    const devices = Array.from({ length: 5 }, (_, index) => createDevice(`device-${index}`, {
      label: `Browser ${index}`,
      lastIp: `192.168.1.${index + 10}`
    }));
    const { props, rerender } = renderDeviceList({ devices });

    screen.getByRole("button", { name: "Show all groups" }).focus();
    rerender(
      <main>
        <AccessDeviceList {...props} devices={[]} />
      </main>
    );

    expect(screen.getByText("Other active tokens")).toHaveFocus();
    expect(screen.getByText("Other active tokens"))
      .toHaveAttribute("data-access-device-list-focus-fallback");
  });
});
