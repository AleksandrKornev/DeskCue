import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assetsApi } from "@api/endpoint/assets/endpoints";

import { ManagedSessionActivityEntries } from "./ManagedSessionActivityEntries";

vi.mock("@api/endpoint/assets/endpoints", () => ({
  assetsApi: {
    getTicketBlob: vi.fn()
  }
}));

const getTicketBlob = vi.mocked(assetsApi.getTicketBlob);

describe("ManagedSessionActivityEntries", () => {
  beforeEach(() => {
    getTicketBlob.mockReset();
    getTicketBlob.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:activity-image")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("keeps the managed-session scope for Markdown assets inside activity details", async () => {
    render(
      <ManagedSessionActivityEntries
        assetContext={{ managedSessionId: "managed-activity-1" }}
        entries={[{
          id: "activity-1",
          parts: [{
            type: "markdown",
            text: "![Activity capture](D:/work/DeskCueWorkspace/activity.png)"
          }],
          phase: "final",
          role: "assistant",
          text: "",
          timestamp: "2026-09-03T10:00:00.000Z"
        }]}
      />
    );

    await screen.findByRole("img", { name: "Activity capture" });
    await waitFor(() => expect(getTicketBlob).toHaveBeenCalledWith(
      "D:/work/DeskCueWorkspace/activity.png",
      "Activity capture",
      expect.objectContaining({
        context: { managedSessionId: "managed-activity-1" },
        kind: "local_image"
      })
    ));
  });
});
