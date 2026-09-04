import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "@modules/transcript/RichTranscriptContent/localAssetActions";

import { WorkspaceFileActions } from "./WorkspaceFileActions";

vi.mock("@modules/transcript/RichTranscriptContent/localAssetActions", () => ({
  downloadLocalAsset: vi.fn(),
  openLocalAssetInNewTab: vi.fn()
}));

const downloadAsset = vi.mocked(downloadLocalAsset);
const openAsset = vi.mocked(openLocalAssetInNewTab);

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

beforeEach(() => {
  downloadAsset.mockReset();
  openAsset.mockReset();
  downloadAsset.mockResolvedValue(undefined);
  openAsset.mockResolvedValue(undefined);
});

describe("WorkspaceFileActions", () => {
  it("keeps keyboard focus and announces a pending action", async () => {
    const action = createDeferred();

    openAsset.mockReturnValueOnce(action.promise);
    render(
      <WorkspaceFileActions
        filePath="packages/protocol/package.json"
        workspaceId="workspace-1"
      />
    );

    const openButton = screen.getByRole("button", { name: "Open file" });

    openButton.focus();
    fireEvent.click(openButton);

    expect(screen.getByRole("button", { name: "Opening file" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Opening file" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Download file" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Opening file…");

    await act(async () => {
      action.resolve();
      await action.promise;
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Open file" })).toHaveFocus());
  });

  it("derives the filename while preserving the complete path", async () => {
    render(
      <WorkspaceFileActions
        filePath="packages/protocol/package.json"
        workspaceId="workspace-1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Download file" }));

    await waitFor(() => expect(downloadAsset).toHaveBeenCalledWith(
      "packages/protocol/package.json",
      "package.json",
      { workspaceId: "workspace-1" },
      expect.any(AbortSignal)
    ));
  });
});
