import { RichTranscriptContent } from "@modules/transcript";

import type { ActivityTranscriptContentProps } from "./types";

export function ActivityTranscriptContent({
  entry
}: ActivityTranscriptContentProps) {
  return <RichTranscriptContent entry={entry} />;
}
