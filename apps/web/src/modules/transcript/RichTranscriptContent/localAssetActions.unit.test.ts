import { beforeEach, describe, expect, it, vi } from "vitest";

import { assetsApi } from "@api/endpoint/assets/endpoints";

vi.mock("@api/endpoint/assets/endpoints", () => ({
  assetsApi: {
    createLocalAssetLink: vi.fn()
  }
}));

import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "./localAssetActions";

const createLocalAssetLink = vi.mocked(assetsApi.createLocalAssetLink);

function createAbortableTicket(signal: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
      once: true
    });
  });
}

beforeEach(() => {
  createLocalAssetLink.mockReset();
  vi.restoreAllMocks();
});

describe("localAssetActions", () => {
  it("closes a provisional popup when an open request is aborted", async () => {
    const controller = new AbortController();
    const close = vi.fn();
    const popup = {
      close,
      document: { title: "" },
      location: { href: "" },
      opener: window
    };

    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);

    createLocalAssetLink.mockImplementation((_path, options) => {
      if (!options?.signal) throw new Error("Expected an AbortSignal.");

      return createAbortableTicket(options.signal);
    });

    const opening = openLocalAssetInNewTab(
      "D:/work/report.txt",
      "report.txt",
      undefined,
      controller.signal
    );

    controller.abort();

    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toBe("");
  });

  it("does not click a download anchor after its ticket request is aborted", async () => {
    const controller = new AbortController();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    createLocalAssetLink.mockImplementation((_path, options) => {
      if (!options?.signal) throw new Error("Expected an AbortSignal.");

      return createAbortableTicket(options.signal);
    });

    const downloading = downloadLocalAsset(
      "D:/work/report.txt",
      "report.txt",
      undefined,
      controller.signal
    );

    controller.abort();

    await expect(downloading).rejects.toMatchObject({ name: "AbortError" });
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("does not navigate a popup when abort wins after a ticket resolves", async () => {
    const controller = new AbortController();
    const close = vi.fn();
    const popup = {
      close,
      document: { title: "" },
      location: { href: "" },
      opener: window
    };

    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    createLocalAssetLink.mockResolvedValue({
      expiresAt: "2026-08-31T00:00:00.000Z",
      url: "/api/assets/ticket/resolved"
    });

    const opening = openLocalAssetInNewTab(
      "D:/work/report.txt",
      "report.txt",
      undefined,
      controller.signal
    );

    controller.abort();

    await expect(opening).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(popup.location.href).toBe("");
  });

  it("does not click a download when abort wins after a ticket resolves", async () => {
    const controller = new AbortController();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    createLocalAssetLink.mockResolvedValue({
      expiresAt: "2026-08-31T00:00:00.000Z",
      url: "/api/assets/ticket/resolved"
    });

    const downloading = downloadLocalAsset(
      "D:/work/report.txt",
      "report.txt",
      undefined,
      controller.signal
    );

    controller.abort();

    await expect(downloading).rejects.toMatchObject({ name: "AbortError" });
    expect(anchorClick).not.toHaveBeenCalled();
  });
});
