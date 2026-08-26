import type { CreateAssetTicketResponse } from "@deskcue/protocol";
import { buildApiUrl } from "@api/connection/config";
import {
  getBlob,
  getText,
  postApi
} from "@api/transport/requests";

import type {
  BuildLocalAssetUrlOptions,
  CreateLocalAssetLinkOptions,
  FetchLocalAssetTicketBlobOptions,
  FetchLocalAssetTicketTextOptions
} from "./types";

export const LOCAL_ASSET_LINK_EXPIRY_LABEL = "15 minutes";

export const assetsApi = {
  async createLocalAssetLink(
    assetPath: string,
    options?: CreateLocalAssetLinkOptions
  ) {
    const result = await postApi<CreateAssetTicketResponse>("/api/assets/ticket", {
      agentSessionId: options?.context?.agentSessionId,
      download: options?.download === true,
      kind: options?.kind ?? "file",
      managedSessionId: options?.context?.managedSessionId,
      path: assetPath,
      workspaceId: options?.context?.workspaceId
    });

    if (!result.ok) {
      throw new Error(result.data.error ?? "Unable to create asset link.");
    }

    return {
      expiresAt: result.data.expiresAt,
      url: buildApiUrl(result.data.url)
    };
  },

  getTextPreview(previewUrl: string, displayName: string) {
    return getText(previewUrl, `Unable to preview ${displayName}.`);
  },

  getImageBlob(previewUrl: string, displayName: string) {
    return getBlob(previewUrl, `Unable to preview ${displayName}.`);
  },

  async getTicketBlob(
    assetPath: string,
    displayName: string,
    options?: FetchLocalAssetTicketBlobOptions
  ) {
    const ticket = await assetsApi.createLocalAssetLink(assetPath, {
      context: options?.context,
      kind: options?.kind
    });
    return getBlob(ticket.url, `Unable to preview ${displayName}.`);
  },

  async getTicketText(
    assetPath: string,
    displayName: string,
    options?: FetchLocalAssetTicketTextOptions
  ) {
    const ticket = await assetsApi.createLocalAssetLink(assetPath, {
      context: options?.context
    });
    return getText(ticket.url, `Unable to preview ${displayName}.`);
  },

  buildFileUrl(assetPath: string, options?: BuildLocalAssetUrlOptions) {
    const query = new URLSearchParams({
      path: assetPath
    });

    if (options?.download) {
      query.set("download", "1");
    }

    return buildApiUrl(`/api/assets/file?${query.toString()}`);
  },

  buildImageUrl(assetPath: string) {
    return buildApiUrl(`/api/assets/local-image?path=${encodeURIComponent(assetPath)}`);
  }
};
