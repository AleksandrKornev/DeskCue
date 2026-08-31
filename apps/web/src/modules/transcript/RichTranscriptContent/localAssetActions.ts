import { assetsApi } from "@api/endpoint/assets/endpoints";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";

export async function openLocalAssetInNewTab(
  assetPath: string,
  displayName: string,
  context?: LocalAssetLinkContext,
  signal?: AbortSignal
) {
  const opened = window.open("about:blank", "_blank");

  if (!opened) {
    throw new Error("Popup was blocked.");
  }

  try {
    opened.opener = null;
    opened.document.title = displayName;
    const ticket = await assetsApi.createLocalAssetLink(assetPath, {
      context,
      signal
    });

    signal?.throwIfAborted();
    opened.location.href = ticket.url;
  } catch (error) {
    opened.close();
    throw error;
  }
}

export async function downloadLocalAsset(
  assetPath: string,
  displayName: string,
  context?: LocalAssetLinkContext,
  signal?: AbortSignal
) {
  const ticket = await assetsApi.createLocalAssetLink(assetPath, {
    context,
    download: true,
    signal
  });

  signal?.throwIfAborted();

  const anchor = document.createElement("a");

  anchor.href = ticket.url;
  anchor.download = displayName;
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
