import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptPart } from "@deskcue/protocol";
import { assetsApi } from "@api/endpoint/assets/endpoints";
import { openLocalAssetInNewTab } from "@modules/transcript/RichTranscriptContent/localAssetActions";

import styles from "./styles.module.scss";
import { TranscriptAttachmentCard } from "./TranscriptAttachment";

vi.mock("@api/endpoint/assets/endpoints", () => ({
  LOCAL_ASSET_LINK_EXPIRY_LABEL: "15 minutes",
  LOCAL_ASSET_TEXT_PREVIEW_MAX_BYTES: 2 * 1024 * 1024,
  assetsApi: {
    buildFileUrl: vi.fn((path: string) => `/api/assets/local-file?path=${encodeURIComponent(path)}`),
    buildImageUrl: vi.fn((path: string) => `/api/assets/local-image?path=${encodeURIComponent(path)}`),
    createLocalAssetLink: vi.fn(),
    getImageBlob: vi.fn(),
    getTextPreview: vi.fn(),
    getTicketBlob: vi.fn(),
    getTicketText: vi.fn()
  }
}));

vi.mock("@modules/transcript/RichTranscriptContent/localAssetActions", () => ({
  downloadLocalAsset: vi.fn(),
  openLocalAssetInNewTab: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn()
  }
}));

const getTicketBlob = vi.mocked(assetsApi.getTicketBlob);
const openLocalAsset = vi.mocked(openLocalAssetInNewTab);

function localImagePart(path: string): Extract<TranscriptPart, { type: "attachment" }> {
  return {
    kind: "local-image",
    label: "Screenshot",
    path,
    type: "attachment",
    url: null
  };
}

function localFilePart(path: string): Extract<TranscriptPart, { type: "attachment" }> {
  return {
    kind: "local-file",
    label: path.split("/").pop() ?? path,
    path,
    type: "attachment",
    url: null
  };
}

describe("TranscriptAttachmentCard", () => {
  beforeEach(() => {
    getTicketBlob.mockReset();
    openLocalAsset.mockReset();
    openLocalAsset.mockResolvedValue(undefined);
    vi.mocked(toast.error).mockReset();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:transcript-attachment")
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn()
    });
  });

  it("keeps dense and compact layout modes explicit", () => {
    const { container, rerender } = render(
      <TranscriptAttachmentCard dense part={localImagePart("C:/tmp/dense.png")} />
    );

    expect(container.firstElementChild).toHaveClass(styles.cardDense);
    expect(container.firstElementChild).not.toHaveClass(styles.cardCompact);

    rerender(
      <TranscriptAttachmentCard compact dense part={localImagePart("C:/tmp/compact.png")} />
    );

    expect(container.firstElementChild).toHaveClass(styles.cardDense, styles.cardCompact);
  });

  it("shows a bounded loading state while a local image ticket is pending", async () => {
    getTicketBlob.mockReturnValueOnce(new Promise(() => undefined));

    render(
      <TranscriptAttachmentCard
        assetContext={{ managedSessionId: "managed-1" }}
        dense
        part={localImagePart("C:/tmp/loading.png")}
      />
    );

    expect(await screen.findByLabelText("Loading image preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview loading.png" })).toBeInTheDocument();
  });

  it("exposes image failure and retries after consecutive request failures", async () => {
    getTicketBlob
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("still offline"))
      .mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }));

    render(
      <TranscriptAttachmentCard
        assetContext={{ managedSessionId: "managed-1" }}
        dense
        part={localImagePart("C:/tmp/retry.png")}
      />
    );

    const retry = await screen.findByRole("button", { name: "Retry preview retry.png" });

    expect(retry).toHaveTextContent("Preview unavailable");

    expect(retry).toHaveTextContent("Retry");

    fireEvent.click(retry);
    await waitFor(() => expect(getTicketBlob).toHaveBeenCalledTimes(2));

    fireEvent.click(await screen.findByRole("button", { name: "Retry preview retry.png" }));

    expect(await screen.findByRole("img", { name: "retry.png" })).toBeInTheDocument();
    await waitFor(() => expect(getTicketBlob).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "Preview retry.png" })).toBeInTheDocument();
  });

  it("opens the universal preview sheet for a local text attachment", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob(["package contents"], { type: "text/plain" }));

    render(
      <TranscriptAttachmentCard
        assetContext={{ managedSessionId: "managed-1" }}
        part={localFilePart("packages/protocol/package.json")}
      />
    );

    const previewTrigger = screen.getByRole("button", { name: "Preview package.json" });

    expect(previewTrigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(previewTrigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(previewTrigger);

    expect(previewTrigger).toHaveAttribute("aria-expanded", "true");

    expect(await screen.findByLabelText("package.json contents"))
      .toHaveTextContent("package contents");
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("reports a direct local open failure", async () => {
    openLocalAsset.mockRejectedValueOnce(new Error("Open blocked"));

    render(
      <TranscriptAttachmentCard
        assetContext={{ managedSessionId: "managed-1" }}
        part={localFilePart("packages/protocol/package.json")}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Open package.json" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Open blocked"));
  });

  it("retries a local image that fails while its preview sheet is open", async () => {
    let rejectPreview!: (reason?: unknown) => void;

    getTicketBlob
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectPreview = reject;
      }))
      .mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }));

    render(
      <TranscriptAttachmentCard
        assetContext={{ managedSessionId: "managed-1" }}
        dense
        part={localImagePart("C:/tmp/pending.png")}
      />
    );

    await screen.findByLabelText("Loading image preview");
    fireEvent.click(screen.getByRole("button", { name: "Preview pending.png" }));

    act(() => {
      rejectPreview(new Error("offline"));
    });

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => expect(getTicketBlob).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("img", { name: "pending.png" })).toBeInTheDocument();
  });

  it("treats an environment file declared as a local image as bounded text", async () => {
    getTicketBlob.mockResolvedValueOnce(new Blob(["TOKEN=visible"], { type: "text/plain" }));

    const { container } = render(
      <TranscriptAttachmentCard
        assetContext={{ managedSessionId: "managed-1" }}
        part={localImagePart("secrets/.env.png")}
      />
    );

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(getTicketBlob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Preview .env.png" }));

    expect(await screen.findByLabelText(".env.png contents")).toHaveTextContent("TOKEN=visible");
    expect(getTicketBlob).toHaveBeenCalledWith(
      "secrets/.env.png",
      ".env.png",
      expect.objectContaining({ kind: "file", maxBytes: 2 * 1024 * 1024 })
    );
  });

  it("opens an explicit unsupported state for a local binary attachment", () => {
    render(<TranscriptAttachmentCard part={localFilePart("artifacts/archive.zip")} />);

    fireEvent.click(screen.getByRole("button", { name: "Preview archive.zip" }));

    expect(screen.getByRole("status"))
      .toHaveTextContent("Preview unavailable for this file type");
    expect(getTicketBlob).not.toHaveBeenCalled();
  });
});
