import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { assetsApi } from "@api/endpoint/assets/endpoints";
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

import { LocalAssetActionDialog } from "./LocalAssetActionDialog";
import { LocalMarkdownAssetLink } from "./LocalMarkdownAssetLink";

const downloadAsset = vi.mocked(downloadLocalAsset);
const openAsset = vi.mocked(openLocalAssetInNewTab);
let getTicketBlob: MockInstance<typeof assetsApi.getTicketBlob>;
let createLocalAssetLink: MockInstance<typeof assetsApi.createLocalAssetLink>;

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

function PreviewAssetFixture({ assetPath }: { assetPath: string }) {
  const displayName = assetPath.split("/").pop() ?? assetPath;

  return (
    <LocalMarkdownAssetLink
      assetContext={{ workspaceId: "workspace-1" }}
      assetPath={assetPath}
      displayName={displayName}
    >
      {displayName}
    </LocalMarkdownAssetLink>
  );
}

function DirectChangingDialogFixture() {
  const [assetPath, setAssetPath] = useState("reports/first.txt");

  return (
    <>
      <button onClick={() => setAssetPath("reports/second.txt")} type="button">
        Change direct asset
      </button>
      <LocalAssetActionDialog
        assetContext={{ workspaceId: "workspace-1" }}
        assetPath={assetPath}
        displayName="Authored label"
        isOpen
        onClose={vi.fn()}
      />
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
  createLocalAssetLink = vi.spyOn(assetsApi, "createLocalAssetLink");
  getTicketBlob = vi.spyOn(assetsApi, "getTicketBlob");
  downloadAsset.mockReset();
  openAsset.mockReset();
  createLocalAssetLink.mockResolvedValue({ expiresAt: "2099-01-01T00:00:00.000Z", url: "/asset-ticket" });
  getTicketBlob.mockResolvedValue(new Blob(["preview text"], { type: "text/plain" }));
  downloadAsset.mockResolvedValue(undefined);
  openAsset.mockResolvedValue(undefined);
});

describe("LocalAssetActionDialog", () => {
  it("shows the real filename above the complete asset path", () => {
    render(<ChangingLocalAssetFixture />);

    fireEvent.click(screen.getByRole("link", { name: "report.txt" }));

    expect(screen.getByRole("dialog", { name: "first.txt" })).toBeInTheDocument();
    expect(screen.getByText("reports/first.txt")).toHaveAttribute("title", "reports/first.txt");
  });

  it("invalidates preview and pending actions when a mounted dialog changes identity", async () => {
    const action = createDeferred();
    let actionSignal: AbortSignal | undefined;

    getTicketBlob
      .mockResolvedValueOnce(new Blob(["first preview"], { type: "text/plain" }))
      .mockReturnValueOnce(new Promise<Blob>(() => undefined));
    openAsset.mockImplementationOnce((_path, _name, _context, signal) => {
      actionSignal = signal;

      return action.promise;
    });

    render(<DirectChangingDialogFixture />);

    expect(await screen.findByLabelText("first.txt contents")).toHaveTextContent("first preview");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Change direct asset" }));

    expect(actionSignal?.aborted).toBe(true);
    expect(screen.getByRole("dialog", { name: "second.txt" })).toBeInTheDocument();
    expect(screen.queryByText("first preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Opening local file…")).not.toBeInTheDocument();

    await act(async () => {
      action.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("dialog", { name: "second.txt" })).toBeInTheDocument();
  });

  it("keeps a real scoped href for browser-native link actions", () => {
    render(<LocalAssetFixture />);

    const link = screen.getByRole("link", { name: "private-output.txt" });

    expect(link).toHaveAttribute(
      "href",
      "/api/assets/file?path=reports%2Fprivate-output.txt&workspaceId=workspace-1"
    );

    expect(link).toHaveAttribute("aria-haspopup", "dialog");
    expect(link).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a failed open action local, safe and directly retryable", async () => {
    openAsset
      .mockRejectedValueOnce(new Error("ECONNREFUSED http://127.0.0.1:4100/private/token"))
      .mockResolvedValueOnce(undefined);

    render(<LocalAssetFixture />);
    fireEvent.click(screen.getByRole("link", { name: "private-output.txt" }));
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
    fireEvent.click(screen.getByRole("link", { name: "private-output.txt" }));
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
    fireEvent.click(screen.getByRole("link", { name: "private-output.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    fireEvent.click(screen.getByRole("button", { name: "Downloading…" }));

    expect(screen.getByText("Preparing download…")).toHaveAttribute("role", "status");
    expect(screen.getByText("Preparing download…").closest("[aria-busy='true']"))
      .toBeNull();
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
    const link = screen.getByRole("link", { name: "private-output.txt" });

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
    fireEvent.click(screen.getByRole("link", { name: "private-output.txt" }));
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
    fireEvent.click(screen.getByRole("link", { name: "report.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    const signal = downloadAsset.mock.calls[0]?.[3];

    fireEvent.click(screen.getByRole("button", { name: "Change asset" }));

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText("Preparing download…")).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("link", { name: "private-output.txt" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(downloadAsset).toHaveBeenCalledTimes(1);
  });

  it("shows bounded text contents for a local file link", async () => {
    render(<PreviewAssetFixture assetPath="packages/protocol/package.json" />);

    fireEvent.click(screen.getByRole("link", { name: "package.json" }));

    expect(await screen.findByLabelText("package.json contents"))
      .toHaveTextContent("preview text");
    expect(getTicketBlob).toHaveBeenCalledWith(
      "packages/protocol/package.json",
      "package.json",
      expect.objectContaining({ maxBytes: 2 * 1024 * 1024 })
    );
  });

  it("probes an unfamiliar source extension as bounded safe text", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob(["---\nlayout: docs\n---"], { type: "text/plain" }));
    render(<PreviewAssetFixture assetPath="src/page.astro" />);

    fireEvent.click(screen.getByRole("link", { name: "page.astro" }));

    expect(await screen.findByLabelText("page.astro contents"))
      .toHaveTextContent("layout: docs");
  });

  it("shows an image inside the sheet for an image file link", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }));
    render(<PreviewAssetFixture assetPath="artifacts/capture.png" />);

    fireEvent.click(screen.getByRole("link", { name: "capture.png" }));

    expect(await screen.findByRole("img", { name: "capture.png" })).toBeInTheDocument();
  });

  it("uses a ranged media URL for video instead of buffering the file", async () => {
    render(<PreviewAssetFixture assetPath="artifacts/run.mp4" />);

    fireEvent.click(screen.getByRole("link", { name: "run.mp4" }));

    const video = await screen.findByLabelText("Preview of run.mp4");

    expect(video).toHaveAttribute("src", "/asset-ticket");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(getTicketBlob).not.toHaveBeenCalled();
  });

  it("shows a compact audio player without buffering the file", async () => {
    render(<PreviewAssetFixture assetPath="artifacts/narration.mp3" />);

    fireEvent.click(screen.getByRole("link", { name: "narration.mp3" }));

    const audio = await screen.findByLabelText("Preview of narration.mp3");

    expect(audio).toHaveAttribute("src", "/asset-ticket");
    expect(audio).toHaveAttribute("preload", "metadata");
    expect(getTicketBlob).not.toHaveBeenCalled();
  });

  it("shows a sandboxed PDF preview", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob(["pdf"], { type: "application/pdf" }));
    render(<PreviewAssetFixture assetPath="reports/audit.pdf" />);

    fireEvent.click(screen.getByRole("link", { name: "audit.pdf" }));

    const frame = await screen.findByTitle("Preview of audit.pdf");

    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("decodes UTF-16 text only when its byte-order mark is present", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob([
      new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00])
    ], { type: "text/plain" }));
    render(<PreviewAssetFixture assetPath="reports/utf16.txt" />);

    fireEvent.click(screen.getByRole("link", { name: "utf16.txt" }));

    expect(await screen.findByLabelText("utf16.txt contents")).toHaveTextContent("Hi");
  });

  it("shows an explicit unsupported state without reading a binary file", () => {
    render(<PreviewAssetFixture assetPath="artifacts/archive.zip" />);

    fireEvent.click(screen.getByRole("link", { name: "archive.zip" }));

    expect(screen.getByText("Preview unavailable for this file type")).toBeInTheDocument();
    expect(getTicketBlob).not.toHaveBeenCalled();
  });

  it("previews environment files as bounded text", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob(["APP_MODE=local"], { type: "text/plain" }));
    render(<PreviewAssetFixture assetPath="secrets/.env.png" />);

    fireEvent.click(screen.getByRole("link", { name: ".env.png" }));

    expect(await screen.findByLabelText(".env.png contents")).toHaveTextContent("APP_MODE=local");
    expect(getTicketBlob).toHaveBeenCalledWith(
      "secrets/.env.png",
      ".env.png",
      expect.objectContaining({ kind: "file", maxBytes: 2 * 1024 * 1024 })
    );

    expect(createLocalAssetLink).not.toHaveBeenCalled();
  });

  it("rejects binary content masquerading as a text file", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob([
      new Uint8Array([0x41, 0x00, 0x42])
    ], { type: "text/plain" }));
    render(<PreviewAssetFixture assetPath="artifacts/not-really-text.txt" />);

    fireEvent.click(screen.getByRole("link", { name: "not-really-text.txt" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Preview unavailable");
    expect(screen.queryByLabelText("not-really-text.txt contents")).not.toBeInTheDocument();
  });

  it("rejects DEL and C1 control characters in a text preview", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob(["safe\u007funsafe"], { type: "text/plain" }));
    render(<PreviewAssetFixture assetPath="artifacts/control.txt" />);

    fireEvent.click(screen.getByRole("link", { name: "control.txt" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Preview unavailable");
  });

  it("rejects an image whose response MIME does not match", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob(["not an image"], { type: "text/plain" }));
    render(<PreviewAssetFixture assetPath="artifacts/not-really-image.png" />);

    fireEvent.click(screen.getByRole("link", { name: "not-really-image.png" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Image preview unavailable");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("aborts preview loading when the sheet closes", async () => {
    let previewSignal: AbortSignal | undefined;

    getTicketBlob.mockImplementationOnce((_path, _name, options) => {
      previewSignal = options?.signal;
      return new Promise<Blob>(() => undefined);
    });

    render(<PreviewAssetFixture assetPath="artifacts/slow.json" />);

    fireEvent.click(screen.getByRole("link", { name: "slow.json" }));
    await waitFor(() => expect(previewSignal).toBeInstanceOf(AbortSignal));
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(previewSignal).toBeInstanceOf(AbortSignal);
    expect(previewSignal?.aborted).toBe(true);
  });

  it("revokes a blob URL created after the sheet was already closed", async () => {
    let resolvePreview!: (blob: Blob) => void;
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late-preview");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");

    getTicketBlob.mockReturnValueOnce(new Promise<Blob>((resolve) => {
      resolvePreview = resolve;
    }));
    render(<PreviewAssetFixture assetPath="artifacts/slow.png" />);

    fireEvent.click(screen.getByRole("link", { name: "slow.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    act(() => {
      resolvePreview(new Blob(["image"], { type: "image/png" }));
    });

    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1));
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:late-preview");
  });
});
