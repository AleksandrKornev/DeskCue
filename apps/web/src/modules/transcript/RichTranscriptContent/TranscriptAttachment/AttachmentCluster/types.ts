import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";
import type { AttachmentPart } from "@modules/transcript/RichTranscriptContent/types";

export type AttachmentClusterProps = {
  assetContext?: LocalAssetLinkContext;
  dense?: boolean;
  parts: AttachmentPart[];
};

export type AttachmentClusterItemProps = {
  assetContext?: LocalAssetLinkContext;
  isActive: boolean;
  part: AttachmentPart;
  onSelect: () => void;
};
