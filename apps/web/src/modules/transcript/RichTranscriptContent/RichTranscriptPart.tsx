import { MarkdownTranscriptPart } from "./MarkdownContent";
import { TranscriptCardPart } from "./TranscriptCard";
import { TranscriptDiffList } from "./TranscriptDiff";
import type { RichTranscriptPartProps } from "./types";

export function RichTranscriptPart({ assetContext, part }: RichTranscriptPartProps) {
  if (part.type === "markdown") {
    return <MarkdownTranscriptPart assetContext={assetContext} part={part} />;
  }

  if (part.type === "diff") {
    return <TranscriptDiffList parts={[part]} />;
  }

  return <TranscriptCardPart part={part} />;
}
