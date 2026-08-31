import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "@modules/transcript/RichTranscriptContent/localAssetActions";

import type { LocalAssetActionDialogProps } from "./types";

export type LocalAssetAction = "download" | "open";

export async function runLocalAssetAction(
  action: LocalAssetAction,
  props: Pick<LocalAssetActionDialogProps, "assetContext" | "assetPath" | "displayName">,
  signal: AbortSignal
) {
  if (action === "open") {
    await openLocalAssetInNewTab(props.assetPath, props.displayName, props.assetContext, signal);
    return;
  }

  await downloadLocalAsset(props.assetPath, props.displayName, props.assetContext, signal);
}
