import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { assetsApi } from "@api/endpoint/assets/endpoints";
import { openLocalAssetInNewTab } from "@modules/transcript/RichTranscriptContent/localAssetActions";

import { LocalMarkdownImage } from "./LocalMarkdownImage";

vi.mock("@assets/images/icon-close.svg?react", () => ({
  default: () => <span aria-hidden="true" />
}));
vi.mock("@api/endpoint/assets/endpoints", () => ({
  assetsApi: {
    buildImageUrl: vi.fn((path: string) => `/api/assets/local-image?path=${encodeURIComponent(path)}`),
    getImageBlob: vi.fn(),
    getTicketBlob: vi.fn()
  }
}));
vi.mock("@modules/transcript/RichTranscriptContent/localAssetActions", () => ({
  downloadLocalAsset: vi.fn(),
  openLocalAssetInNewTab: vi.fn()
}));

const getTicketBlob = vi.mocked(assetsApi.getTicketBlob);
const getImageBlob = vi.mocked(assetsApi.getImageBlob);
const openLocalAsset = vi.mocked(openLocalAssetInNewTab);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe("LocalMarkdownImage", () => {
  beforeEach(() => {
    getImageBlob.mockReset();
    getTicketBlob.mockReset();
    openLocalAsset.mockReset();
    getImageBlob.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    getTicketBlob.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:local-markdown-image")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("opens local image actions from the inline preview", async () => {
    render(
      <LocalMarkdownImage
        alt="Header capture"
        assetContext={{ managedSessionId: "managed-1" }}
        assetPath="D:/work/DeskCueWorkspace/header.png"
      />
    );

    const actionTrigger = await screen.findByRole("button", {
      name: "Image actions: Header capture"
    });

    fireEvent.click(actionTrigger);

    expect(screen.getByRole("dialog", { name: "header.png" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Header capture" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    expect(getTicketBlob).toHaveBeenCalledWith(
      "D:/work/DeskCueWorkspace/header.png",
      "Header capture",
      expect.objectContaining({ kind: "local_image" })
    );
  });

  it("keeps consecutive local images independent and opens only the selected preview", async () => {
    render(
      <div>
        {[
          ["First capture", "D:/work/DeskCueWorkspace/first.png"],
          ["Second capture", "D:/work/DeskCueWorkspace/second.png"],
          ["Third capture", "D:/work/DeskCueWorkspace/third.png"]
        ].map(([alt, assetPath]) => (
          <LocalMarkdownImage
            alt={alt}
            assetContext={{ managedSessionId: "managed-1" }}
            assetPath={assetPath}
            key={assetPath}
          />
        ))}
      </div>
    );

    await screen.findByRole("img", { name: "Third capture" });
    expect(screen.getAllByRole("button", { name: /Image actions:/u })).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Image actions: Second capture" }));

    expect(screen.getByRole("dialog", { name: "second.png" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Second capture" })).toHaveLength(2);
    expect(screen.queryByRole("dialog", { name: "first.png" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "third.png" })).not.toBeInTheDocument();
  });

  it("stays non-interactive inside an existing Markdown link", async () => {
    render(
      <LocalMarkdownImage
        alt="Linked capture"
        assetPath="D:/work/DeskCueWorkspace/header.png"
        interactive={false}
      />
    );

    await waitFor(() => expect(screen.getByRole("img", { name: "Linked capture" }))
      .toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Image actions/u })).not.toBeInTheDocument();
  });

  it("keeps image actions available when the inline preview cannot load", async () => {
    getTicketBlob.mockRejectedValueOnce(new Error("missing image"));

    render(
      <LocalMarkdownImage
        alt="Missing capture"
        assetContext={{ managedSessionId: "managed-1" }}
        assetPath="D:/work/DeskCueWorkspace/missing.png"
      />
    );

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Local image unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Image actions: Missing capture" }));

    const dialog = screen.getByRole("dialog", { name: "missing.png" });

    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Image preview unavailable");
    expect(within(dialog).getByRole("alert"))
      .toHaveTextContent("You can still open or download the file.");

    expect(screen.getByRole("button", { name: "Open" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("shows preview progress in the dialog when it opens before the image loads", async () => {
    const image = createDeferred<Blob>();

    getTicketBlob.mockReturnValueOnce(image.promise);
    render(
      <LocalMarkdownImage
        alt="Slow capture"
        assetContext={{ managedSessionId: "managed-1" }}
        assetPath="D:/work/DeskCueWorkspace/slow.png"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Image actions: Slow capture" }));

    const dialog = screen.getByRole("dialog", { name: "slow.png" });

    expect(within(dialog).getByRole("status")).toHaveTextContent("Loading image preview…");

    image.resolve(new Blob(["image"], { type: "image/png" }));

    await waitFor(() => expect(within(dialog).getByRole("img", { name: "Slow capture" }))
      .toBeInTheDocument());
    expect(within(dialog).queryByText("Loading image preview…")).not.toBeInTheDocument();
  });

  it("reports a preview decode failure without removing file actions", async () => {
    render(
      <LocalMarkdownImage
        alt="Corrupt capture"
        assetContext={{ managedSessionId: "managed-1" }}
        assetPath="D:/work/DeskCueWorkspace/corrupt.png"
      />
    );

    fireEvent.click(await screen.findByRole("button", {
      name: "Image actions: Corrupt capture"
    }));

    const dialog = screen.getByRole("dialog", { name: "corrupt.png" });

    fireEvent.error(within(dialog).getByRole("img", { name: "Corrupt capture" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("Image preview unavailable");
    expect(within(dialog).getByRole("alert"))
      .toHaveTextContent("You can still open or download the file.");

    expect(within(dialog).getByRole("button", { name: "Open" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Download" })).toBeEnabled();
  });

  it("never exposes the previous preview or action dialog after the image identity changes", async () => {
    const nextImage = createDeferred<Blob>();

    getTicketBlob
      .mockResolvedValueOnce(new Blob(["first"], { type: "image/png" }))
      .mockReturnValueOnce(nextImage.promise);
    const { rerender } = render(
      <LocalMarkdownImage
        alt="First capture"
        assetContext={{ managedSessionId: "managed-1" }}
        assetPath="D:/work/DeskCueWorkspace/first.png"
      />
    );

    await screen.findByRole("img", { name: "First capture" });
    fireEvent.click(screen.getByRole("button", { name: "Image actions: First capture" }));
    expect(screen.getByRole("dialog", { name: "first.png" })).toBeInTheDocument();

    rerender(
      <LocalMarkdownImage
        alt="Second capture"
        assetContext={{ managedSessionId: "managed-1" }}
        assetPath="D:/work/DeskCueWorkspace/second.png"
      />
    );

    expect(screen.queryByRole("img", { name: "First capture" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "first.png" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading local image");

    fireEvent.click(screen.getByRole("button", { name: "Image actions: Second capture" }));
    expect(screen.getByRole("dialog", { name: "second.png" })).toBeInTheDocument();

    nextImage.resolve(new Blob(["second"], { type: "image/png" }));
    await waitFor(() => expect(screen.getAllByRole("img", { name: "Second capture" }))
      .toHaveLength(2));

    rerender(
      <LocalMarkdownImage
        alt="First capture"
        assetContext={{ managedSessionId: "managed-1" }}
        assetPath="D:/work/DeskCueWorkspace/first.png"
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("aborts a pending file action when the image identity changes", async () => {
    const action = createDeferred<void>();
    let actionSignal: AbortSignal | undefined;

    openLocalAsset.mockImplementation((_path, _name, _context, signal) => {
      actionSignal = signal;

      return action.promise;
    });
    const { rerender } = render(
      <LocalMarkdownImage
        alt="First capture"
        assetContext={{ managedSessionId: "managed-1" }}
        assetPath="D:/work/DeskCueWorkspace/first.png"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Image actions: First capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Opening local file…")).toBeInTheDocument();

    rerender(
      <LocalMarkdownImage
        alt="Second capture"
        assetContext={{ managedSessionId: "managed-1" }}
        assetPath="D:/work/DeskCueWorkspace/second.png"
      />
    );

    expect(actionSignal?.aborted).toBe(true);
    expect(screen.queryByRole("dialog", { name: "first.png" })).not.toBeInTheDocument();
    action.resolve();
  });
});
