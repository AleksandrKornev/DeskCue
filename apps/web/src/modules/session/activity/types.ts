import type { ChatTranscriptEntry } from "@modules/session/types";

export type ManagedSessionActivityEntriesProps = {
  deferEntryRender?: boolean;
  entries: ChatTranscriptEntry[];
  entryLimit?: number;
  errorLabel?: string | null;
  hideCompactEntries?: boolean;
  loadingLabel?: string;
};

export type ActivityTranscriptContentProps = {
  entry: ChatTranscriptEntry | { text: string; parts?: ChatTranscriptEntry["parts"] };
};
