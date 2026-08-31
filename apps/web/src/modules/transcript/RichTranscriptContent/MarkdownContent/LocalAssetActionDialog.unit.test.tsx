import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "@modules/transcript/RichTranscriptContent/localAssetActions";

vi.mock("@assets/images/icon-close.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));
vi.mock("@modules/transcript/RichTranscriptContent/localAssetActions", () => ({
  downloadLocalAsset: vi.fn(),
  openLocalAssetInNewTab: vi.fn()
}));

import { LocalMarkdownAssetLink } from "./LocalMarkdownAssetLink";

const downloadAsset = vi.mocked(downloadLocalAsset);
const openAsset = vi.mocked(openLocalAssetInNewTab);

function LocalAssetFixture() {
  const [visibleLink, setVisibleLink] = useState(true);

  return (
    <>
      <button onClick={() => setVisibleLink((visible) => !visible)} type="button">
        Toggle link
      </button>
      {visibleLink ? (
        <LocalMarkdownAssetLink
          assetContext={{ workspaceId: "workspace-1" }}
          assetPath="reports/private-output.txt"
          displayName="private-output.txt"
        >
          private-output.txt
        </LocalMarkdownAssetLink>
      ) : null}
    </>
  );
}

function ChangingLocalAssetFixture() {
  const [assetPath, setAssetPath] = useState("reports/first.txt");

  return (
    <>
      <button onClick={() => setAssetPath("reports/second.txt")} type="button">
        Change asset
      </button>
      <LocalMarkdownAssetLink
        assetContext={{ workspaceId: "workspace-1" }}
        assetPath={assetPath}
        displayName="report.txt"
      >
        report.txt
      </LocalMarkdownAssetLink>
    </>
  );
}

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

beforeEach(() => {
  downloadAsset.mockReset();
  openAsset.mockReset();
  downloadAsset.mockResolvedValue(undefined);
  openAsset.mockResolvedValue(undefined);
});

describe("LocalAssetActionDialog", () => {
  it("keeps a failed open action local, safe and directly retryable", async () => {
    openAsset
      .mockRejectedValueOnce(new Error("ECONNREFUSED http://127.0.0.1:4100/private/token"))
      .mockResolvedValueOnce(undefined);

    render(<LocalAssetFixture />);
    fireEvent.click(screen.getByRole("button", { name: "private-output.txt" }));
    const openButton = screen.getByRole("button", { name: "Open" });

    openButton.focus();
    fireEvent.click(openButton);

    expect(await screen.findByRole("alert", { name: "File unavailable" }))
      .toHaveTextContent("Check that the file still exists");
    expect(screen.queryByText(/ECONNREFUSED|127\.0\.0\.1|private\/token/u))
      .not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Try open again" }))
      .toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Try open again" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(openAsset).toHaveBeenCalledTimes(2);
  });

  it("does not steal focus when the user moves it before error focus recovery", async () => {
    let focusFrame: FrameRequestCallback | null = null;

    openAsset.mockRejectedValueOnce(new Error("temporary failure"));
    render(<LocalAssetFixture />);
    fireEvent.click(screen.getByRole("button", { name: "private-output.txt" }));
    const openButton = screen.getByRole("button", { name: "Open" });

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      focusFrame = callback;
      return 1;
    });

    openButton.focus();
    fireEvent.click(openButton);

    await screen.findByRole("alert", { name: "File unavailable" });
    const downloadButton = screen.getByRole("button", { name: "Download" });

    downloadButton.focus();
    act(() => focusFrame?.(0));

    expect(downloadButton).toHaveFocus();
  });

  it("announces pending work and rejects a duplicate action", () => {
    const deferred = createDeferred();

    downloadAsset.mockReturnValueOnce(deferred.promise);
    render(<LocalAssetFixture />);
    fireEvent.click(screen.getByRole("button", { name: "private-output.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    fireEvent.click(screen.getByRole("button", { name: "Downloading…" }));

    expect(screen.getByRole("status")).toHaveTextContent("Preparing download…");
    expect(screen.getByText("Preparing download…").parentElement)
      .toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Downloading…" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Open" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(downloadAsset).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale request close a newly opened dialog", async () => {
    const deferred = createDeferred();

    openAsset.mockReturnValueOnce(deferred.promise);
    render(<LocalAssetFixture />);
    const link = screen.getByRole("button", { name: "private-output.txt" });

    fireEvent.click(link);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.click(link);

    expect(openAsset.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
    expect(openAsset.mock.calls[0]?.[3]?.aborted).toBe(true);
    expect(screen.getByRole("dialog", { name: "private-output.txt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    expect(screen.getByRole("dialog", { name: "private-output.txt" })).toBeInTheDocument();
  });

  it("ignores a late failure after its link leaves the transcript", async () => {
    const deferred = createDeferred();

    downloadAsset.mockReturnValueOnce(deferred.promise);
    render(<LocalAssetFixture />);
    fireEvent.click(screen.getByRole("button", { name: "private-output.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle link" }));

    await act(async () => {
      deferred.reject(new Error("late transport failure"));

      try {
        await deferred.promise;
      } catch {
        // The UI intentionally ignores this stale failure.
      }
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/late transport failure/u)).not.toBeInTheDocument();
  });

  it("aborts pending work when the selected asset identity changes", () => {
    const deferred = createDeferred();

    downloadAsset.mockReturnValueOnce(deferred.promise);
    render(<ChangingLocalAssetFixture />);
    fireEvent.click(screen.getByRole("button", { name: "report.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    const signal = downloadAsset.mock.calls[0]?.[3];

    fireEvent.click(screen.getByRole("button", { name: "Change asset" }));

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("reports/second.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" }))
      .toHaveAttribute("aria-disabled", "false");
  });

  it("settles an action after Strict Mode replays the mount lifecycle", async () => {
    render(
      <StrictMode>
        <LocalAssetFixture />
      </StrictMode>
    );

    fireEvent.click(screen.getByRole("button", { name: "private-output.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(downloadAsset).toHaveBeenCalledTimes(1);
  });
});
