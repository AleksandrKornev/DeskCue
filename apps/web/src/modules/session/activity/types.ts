import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";
import type { ChatTranscriptEntry } from "@modules/session/types";

export type ManagedSessionActivityEntriesProps = {
  assetContext?: LocalAssetLinkContext;
  deferEntryRender?: boolean;
  entries: ChatTranscriptEntry[];
  entryLimit?: number;
  errorLabel?: string | null;
  hideCompactEntries?: boolean;
  loadingLabel?: string;
};

export type ActivityTranscriptContentProps = {
  assetContext?: LocalAssetLinkContext;
  entry: ChatTranscriptEntry | { text: string; parts?: ChatTranscriptEntry["parts"] };
};

export type ActivityEntryListProps = {
  assetContext?: LocalAssetLinkContext;
  entries: ChatTranscriptEntry[];
};

export type ActivityEntryArticleProps = {
  assetContext?: LocalAssetLinkContext;
  entry: ChatTranscriptEntry;
};
