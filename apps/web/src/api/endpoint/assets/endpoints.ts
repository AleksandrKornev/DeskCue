import type { CreateAssetTicketResponse } from "@deskcue/protocol";
import { buildApiUrl } from "@api/connection/config";
import {
  getRangedBlob,
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
export const LOCAL_ASSET_TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

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
      maxBytes: options?.maxBytes,
      path: assetPath,
      workspaceId: options?.context?.workspaceId
    }, { signal: options?.signal });

    if (!result.ok) throw new Error(result.data.error ?? "Unable to create asset link.");

    return {
      expiresAt: result.data.expiresAt,
      url: buildApiUrl(result.data.url)
    };
  },

  getTextPreview(previewUrl: string, displayName: string) {
    return getText(previewUrl, `Unable to preview ${displayName}.`);
  },

  getImageBlob(previewUrl: string, displayName: string, signal?: AbortSignal) {
    return getRangedBlob(previewUrl, `Unable to preview ${displayName}.`, { signal });
  },

  async getTicketBlob(
    assetPath: string,
    displayName: string,
    options?: FetchLocalAssetTicketBlobOptions
  ) {
    const hasSessionScope = Boolean(
      options?.context?.agentSessionId || options?.context?.managedSessionId
    );
    const previewUrl = hasSessionScope
      ? assetsApi.buildFileUrl(assetPath, { context: options?.context })
      : (await assetsApi.createLocalAssetLink(assetPath, {
          context: options?.context,
          kind: options?.kind,
          maxBytes: options?.maxBytes,
          signal: options?.signal
        })).url;

    return getRangedBlob(previewUrl, `Unable to preview ${displayName}.`, {
      maximumBytes: options?.maxBytes,
      signal: options?.signal
    });
  },

  async getTicketText(
    assetPath: string,
    displayName: string,
    options?: FetchLocalAssetTicketTextOptions
  ) {
    const hasSessionScope = Boolean(
      options?.context?.agentSessionId || options?.context?.managedSessionId
    );
    const previewUrl = hasSessionScope
      ? assetsApi.buildFileUrl(assetPath, { context: options?.context })
      : (await assetsApi.createLocalAssetLink(assetPath, {
          context: options?.context,
          maxBytes: options?.maxBytes ?? LOCAL_ASSET_TEXT_PREVIEW_MAX_BYTES,
          signal: options?.signal
        })).url;

    const blob = await getRangedBlob(previewUrl, `Unable to preview ${displayName}.`, {
      maximumBytes: options?.maxBytes ?? LOCAL_ASSET_TEXT_PREVIEW_MAX_BYTES,
      signal: options?.signal
    });

    return blob.text();
  },

  buildFileUrl(assetPath: string, options?: BuildLocalAssetUrlOptions) {
    const query = new URLSearchParams({
      path: assetPath
    });

    if (options?.context?.agentSessionId) query.set("agentSessionId", options.context.agentSessionId);
    if (options?.context?.managedSessionId) query.set("managedSessionId", options.context.managedSessionId);
    if (options?.context?.workspaceId) query.set("workspaceId", options.context.workspaceId);
    if (options?.download) query.set("download", "1");

    return buildApiUrl(`/api/assets/file?${query.toString()}`);
  },

  buildImageUrl(assetPath: string) {
    return buildApiUrl(`/api/assets/local-image?path=${encodeURIComponent(assetPath)}`);
  }
};
