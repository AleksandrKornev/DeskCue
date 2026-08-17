import { describe, expect, it, vi } from "vitest";

const requestMocks = vi.hoisted(() => ({
  deleteApi: vi.fn(),
  getJson: vi.fn(),
  patchApi: vi.fn(),
  postApi: vi.fn()
}));

vi.mock("@api/transport/requests", () => requestMocks);

import { cloudApi } from "./endpoints";

describe("cloudApi", () => {
  it("sends the complete permission set to the connected-profile endpoint", () => {
    const input = {
      allowRemoteControl: true,
      allowRemoteFiles: false,
      allowRemotePreview: true,
      allowRemoteRead: false
    };

    cloudApi.updatePermissions(input);

    expect(requestMocks.patchApi).toHaveBeenCalledWith(
      "/api/cloud/connection/permissions",
      input
    );
  });
});
