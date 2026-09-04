import { assetsApi } from "@api/endpoint/assets/endpoints";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";

function hasSessionAssetScope(context?: LocalAssetLinkContext) {
  return Boolean(context?.agentSessionId || context?.managedSessionId);
}

async function resolveLocalAssetActionUrl(
  assetPath: string,
  context: LocalAssetLinkContext | undefined,
  download: boolean,
  signal?: AbortSignal
) {
  if (hasSessionAssetScope(context)) {
    signal?.throwIfAborted();

    return assetsApi.buildFileUrl(assetPath, { context, download });
  }

  const ticket = await assetsApi.createLocalAssetLink(assetPath, {
    context,
    download,
    signal
  });

  return ticket.url;
}

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
    const url = await resolveLocalAssetActionUrl(assetPath, context, false, signal);

    signal?.throwIfAborted();
    opened.location.href = url;
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
  const url = await resolveLocalAssetActionUrl(assetPath, context, true, signal);

  signal?.throwIfAborted();

  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = displayName;
  anchor.rel = "noreferrer";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
