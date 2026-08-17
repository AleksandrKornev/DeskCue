import { memo } from "react";

import { RichTranscriptContent } from "@modules/transcript";

import { areTranscriptContentPropsEqual } from "./helpers";
import type { TranscriptContentProps } from "./types";

export const TranscriptContent = memo(function TranscriptContent(
  props: TranscriptContentProps
) {
  return <RichTranscriptContent {...props} />;
}, areTranscriptContentPropsEqual);
