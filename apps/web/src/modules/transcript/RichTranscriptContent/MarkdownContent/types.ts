import type { TranscriptPart } from "@deskcue/protocol";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";

export type MarkdownTranscriptPartProps = {
  assetContext?: LocalAssetLinkContext;
  part: Extract<TranscriptPart, { type: "markdown" }>;
};

export type LocalMarkdownImageProps = {
  alt: string;
  assetContext?: LocalAssetLinkContext;
  assetPath: string;
};

export type LocalAssetActionDialogProps = {
  assetContext?: LocalAssetLinkContext;
  assetPath: string;
  displayName: string;
  isOpen: boolean;
  onClose: () => void;
};
