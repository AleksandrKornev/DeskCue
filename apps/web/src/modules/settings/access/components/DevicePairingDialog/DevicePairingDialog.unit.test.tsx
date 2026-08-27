import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@assets/images/icon-close.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));

vi.mock("./components/PairingQrCode", () => ({
  PairingQrCode: () => null
}));

import { DevicePairingDialog } from "./DevicePairingDialog";

describe("DevicePairingDialog", () => {
  it("points connection-address guidance to visible Settings labels", () => {
    render(
      <DevicePairingDialog
        activePairingOrigin="http://127.0.0.1:4100"
        activePairingWebUrl="http://127.0.0.1:4100/connect/pair-code"
        isCustomPairingOrigin={false}
        isSavedPairingOrigin={false}
        pairingHostChoice="generated"
        pairingHostOptions={[]}
        pairingLink={{
          daemonUrl: "http://127.0.0.1:4100",
          pairCode: "pair-code",
          webUrl: "http://127.0.0.1:4100/connect/pair-code"
        }}
        pairingLinkOrigin=""
        onClose={vi.fn()}
        onCopyPairingLink={vi.fn()}
        onManagePairingHosts={vi.fn()}
        onPairingHostChoiceChange={vi.fn()}
        onPairingLinkOriginChange={vi.fn()}
      />
    );

    expect(screen.getByText(/Select saved addresses from Connections/))
      .toBeInTheDocument();
    expect(screen.getByText(/Connections → Manage device access/))
      .toBeInTheDocument();
    expect(screen.queryByText(/from Security|address in Access/))
      .not.toBeInTheDocument();
  });
});
