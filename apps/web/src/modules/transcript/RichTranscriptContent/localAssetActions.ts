import { assetsApi } from "@api/endpoint/assets/endpoints";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";

export async function openLocalAssetInNewTab(
  assetPath: string,
  displayName: string,
  context?: LocalAssetLinkContext
) {
  const opened = window.open("about:blank", "_blank");
  if (!opened) {
    throw new Error("Popup was blocked.");
  }

  try {
    opened.opener = null;
    opened.document.title = displayName;
    opened.location.href = (await assetsApi.createLocalAssetLink(assetPath, {
      context
    })).url;
  } catch (error) {
    opened.close();
    throw error;
  }
}

export async function downloadLocalAsset(
  assetPath: string,
  displayName: string,
  context?: LocalAssetLinkContext
) {
  const ticketUrl = (await assetsApi.createLocalAssetLink(assetPath, {
    context,
    download: true
  })).url;
  const anchor = document.createElement("a");
  anchor.href = ticketUrl;
  anchor.download = displayName;
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
