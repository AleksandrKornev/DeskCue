import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@api/connection/config", () => ({
  buildApiUrl: (path: string) => path
}));

vi.mock("@api/transport/requests", () => ({
  getBlob: vi.fn(),
  getRangedBlob: vi.fn(),
  getText: vi.fn(),
  postApi: vi.fn()
}));

import {
  getRangedBlob,
  postApi
} from "@api/transport/requests";

import { assetsApi } from "./endpoints";

const getRangedBlobMock = vi.mocked(getRangedBlob);
const postApiMock = vi.mocked(postApi);

beforeEach(() => {
  getRangedBlobMock.mockReset();
  postApiMock.mockReset();
});

describe("assetsApi.getTicketBlob", () => {
  it("reads session transcript assets through the strictly scoped direct route", async () => {
    const blob = new Blob(["image"], { type: "image/png" });

    getRangedBlobMock.mockResolvedValue(blob);

    await expect(assetsApi.getTicketBlob("D:/work/image.png", "image.png", {
      context: {
        agentSessionId: "codex:session-1",
        workspaceId: "workspace-1"
      },
      kind: "local_image",
      maxBytes: 1024
    })).resolves.toBe(blob);

    expect(postApiMock).not.toHaveBeenCalled();
    expect(getRangedBlobMock).toHaveBeenCalledWith(
      "/api/assets/file?path=D%3A%2Fwork%2Fimage.png&agentSessionId=codex%3Asession-1&workspaceId=workspace-1",
      "Unable to preview image.png.",
      { maximumBytes: 1024, signal: undefined }
    );
  });

  it("keeps workspace-only previews behind a file-capability ticket", async () => {
    const blob = new Blob(["image"], { type: "image/png" });

    postApiMock.mockResolvedValue({
      data: {
        expiresAt: "2026-09-03T00:00:00.000Z",
        url: "/api/assets/ticket/ticket-1"
      },
      ok: true,
      status: 201
    });

    getRangedBlobMock.mockResolvedValue(blob);

    await expect(assetsApi.getTicketBlob("image.png", "image.png", {
      context: { workspaceId: "workspace-1" },
      kind: "local_image"
    })).resolves.toBe(blob);

    expect(postApiMock).toHaveBeenCalledTimes(1);
    expect(getRangedBlobMock).toHaveBeenCalledWith(
      "/api/assets/ticket/ticket-1",
      "Unable to preview image.png.",
      { maximumBytes: undefined, signal: undefined }
    );
  });
});

describe("assetsApi.getImageBlob", () => {
  it("keeps legacy trusted-image previews on the bounded ranged transport", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const controller = new AbortController();

    getRangedBlobMock.mockResolvedValue(blob);

    await expect(assetsApi.getImageBlob(
      "/api/assets/local-image?path=image.png",
      "image.png",
      controller.signal
    )).resolves.toBe(blob);

    expect(getRangedBlobMock).toHaveBeenCalledWith(
      "/api/assets/local-image?path=image.png",
      "Unable to preview image.png.",
      { signal: controller.signal }
    );
  });
});

describe("assetsApi.getTicketText", () => {
  it("uses a bounded ranged read for a session-scoped text preview", async () => {
    getRangedBlobMock.mockResolvedValue(new Blob(["preview text"], { type: "text/plain" }));

    await expect(assetsApi.getTicketText("D:/work/report.txt", "report.txt", {
      context: { agentSessionId: "codex:session-1" },
      maxBytes: 1024
    })).resolves.toBe("preview text");

    expect(postApiMock).not.toHaveBeenCalled();
    expect(getRangedBlobMock).toHaveBeenCalledWith(
      "/api/assets/file?path=D%3A%2Fwork%2Freport.txt&agentSessionId=codex%3Asession-1",
      "Unable to preview report.txt.",
      { maximumBytes: 1024, signal: undefined }
    );
  });
});
