import type {
  WorkspaceDirectoryResponse,
  WorkspaceFileResponse,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { ApiErrorPayload } from "@api/transport/errors";
import { getJson, postApi } from "@api/transport/requests";

import type { PickWorkspaceApiResponse } from "./types";

export const workspacesApi = {
  create(path: string) {
    return postApi<WorkspaceSummary | ApiErrorPayload>("/api/workspaces", {
      path
    });
  },

  pick() {
    return postApi<PickWorkspaceApiResponse>("/api/workspaces/pick");
  },

  listFiles(
    workspaceId: string,
    options: { cursor?: string | null; limit?: number; path?: string; signal?: AbortSignal } = {}
  ) {
    const query = new URLSearchParams();
    if (options.path) query.set("path", options.path);
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit) query.set("limit", String(options.limit));

    return getJson<WorkspaceDirectoryResponse>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/files${query.size ? `?${query.toString()}` : ""}`,
      "Failed to load workspace files",
      { signal: options.signal }
    );
  },

  readFile(workspaceId: string, path: string, options?: { signal?: AbortSignal }) {
    const query = new URLSearchParams({ path });
    return getJson<WorkspaceFileResponse>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/file?${query.toString()}`,
      "Failed to load workspace file",
      { signal: options?.signal }
    );
  }
};
