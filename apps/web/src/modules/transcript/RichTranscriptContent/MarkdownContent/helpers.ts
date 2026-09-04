import { defaultUrlTransform } from "react-markdown";

import {
  isMarkdownLocalImagePath,
  isMarkdownVideoPath,
  normalizeMarkdownLocalAssetPath
} from "@modules/transcript/RichTranscriptContent/helpers";

export { isMarkdownLocalImagePath, isMarkdownVideoPath };

export function transformTranscriptUrl(value: string) {
  return normalizeMarkdownLocalAssetPath(value) ? value : defaultUrlTransform(value);
}
