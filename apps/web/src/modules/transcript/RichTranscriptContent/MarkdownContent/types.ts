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
  interactive?: boolean;
};

export type LocalMarkdownVideoProps = {
  assetContext?: LocalAssetLinkContext;
  assetPath: string;
  label: string;
};

export type LocalAssetActionDialogProps = {
  assetContext?: LocalAssetLinkContext;
  assetPath: string;
  displayName: string;
  isOpen: boolean;
  onClose: () => void;
  onRetryPreview?: () => void;
  previewImage?: {
    alt: string;
    url: string;
  };

  previewStatus?: "error" | "loading" | "ready";
};
