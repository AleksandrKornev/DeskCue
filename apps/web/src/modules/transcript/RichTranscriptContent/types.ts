import type { AgentTranscriptEntry, TranscriptPart } from "@deskcue/protocol";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";

export type AttachmentPart = Extract<TranscriptPart, { type: "attachment" }>;
export type DiffPart = Extract<TranscriptPart, { type: "diff" }>;
export type AttachmentPreviewKind = "image" | "text" | "pdf" | "none";

export type RichTranscriptContentEntry =
  | Pick<AgentTranscriptEntry, "role" | "text" | "parts">
  | Pick<AgentTranscriptEntry, "text" | "parts">;

export type RichTranscriptContentProps = {
  assetContext?: LocalAssetLinkContext;
  entry: RichTranscriptContentEntry;
  collapseSecondaryParts?: boolean;
};

export type RenderTranscriptPartsOptions = {
  compactAttachments?: boolean;
};

export type RichTranscriptPartProps = {
  assetContext?: LocalAssetLinkContext;
  part: TranscriptPart;
};

export interface DiffFileGroup {
  additions: number;
  changeType: DiffPart["changeType"];
  deletions: number;
  displayPath: string;
  parts: DiffPart[];
}
