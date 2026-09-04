import { RichTranscriptContent } from "@modules/transcript";

import type { ActivityTranscriptContentProps } from "./types";

export function ActivityTranscriptContent({
  assetContext,
  entry
}: ActivityTranscriptContentProps) {
  return <RichTranscriptContent assetContext={assetContext} entry={entry} />;
}
