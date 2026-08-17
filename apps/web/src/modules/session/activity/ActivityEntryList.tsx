import type { ChatTranscriptEntry } from "@modules/session/types";
import {
  mergeBareTranscriptEntries,
  shouldRenderTranscriptEntryBare
} from "@modules/transcript";

import { ActivityEntryArticle } from "./ActivityEntryArticle";
import { ActivityTranscriptContent } from "./ActivityTranscriptContent";

export function ActivityEntryList({ entries }: { entries: ChatTranscriptEntry[] }) {
  const rendered = [];
  let index = 0;

  while (index < entries.length) {
    const entry = entries[index];

    if (shouldRenderTranscriptEntryBare(entry)) {
      const bareEntries: ChatTranscriptEntry[] = [entry];
      let nextIndex = index + 1;

      while (nextIndex < entries.length && shouldRenderTranscriptEntryBare(entries[nextIndex])) {
        bareEntries.push(entries[nextIndex]);
        nextIndex += 1;
      }

      const mergedEntry = mergeBareTranscriptEntries(bareEntries);

      if (mergedEntry) {
        rendered.push(<ActivityTranscriptContent key={`merged:${entry.id}`} entry={mergedEntry} />);
      }

      index = nextIndex;
      continue;
    }

    rendered.push(<ActivityEntryArticle key={entry.id} entry={entry} />);
    index += 1;
  }

  return rendered;
}
