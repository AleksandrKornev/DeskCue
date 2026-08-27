import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptPart } from "@deskcue/protocol";
import { assetsApi } from "@api/endpoint/assets/endpoints";

import styles from "./styles.module.scss";
import { TranscriptAttachmentCard } from "./TranscriptAttachment";

vi.mock("@api/endpoint/assets/endpoints", () => ({
  LOCAL_ASSET_LINK_EXPIRY_LABEL: "15 minutes",
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

const getTicketBlob = vi.mocked(assetsApi.getTicketBlob);

function localImagePart(path: string): Extract<TranscriptPart, { type: "attachment" }> {
  return {
    kind: "local-image",
    label: "Screenshot",
    path,
    type: "attachment",
    url: null
  };
}

describe("TranscriptAttachmentCard", () => {
  beforeEach(() => {
    getTicketBlob.mockReset();
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
});
