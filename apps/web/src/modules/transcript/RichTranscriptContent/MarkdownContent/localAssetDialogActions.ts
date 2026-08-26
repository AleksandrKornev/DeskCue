import { toast } from "sonner";

import {
  downloadLocalAsset,
  openLocalAssetInNewTab
} from "@modules/transcript/RichTranscriptContent/localAssetActions";

import type { LocalAssetActionDialogProps } from "./types";

export type LocalAssetAction = "download" | "open";

export async function runLocalAssetAction(
  action: LocalAssetAction,
  props: Pick<LocalAssetActionDialogProps, "assetContext" | "assetPath" | "displayName" | "onClose">,
  setPendingAction: (action: LocalAssetAction | null) => void
) {
  setPendingAction(action);

  try {
    if (action === "open") {
      await openLocalAssetInNewTab(props.assetPath, props.displayName, props.assetContext);
    } else {
      await downloadLocalAsset(props.assetPath, props.displayName, props.assetContext);
    }

    props.onClose();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : `Unable to ${action} ${props.displayName}`);
  } finally {
    setPendingAction(null);
  }
}
