import { defaultUrlTransform } from "react-markdown";

import { normalizeMarkdownLocalAssetPath } from "@modules/transcript/RichTranscriptContent/helpers";

const MARKDOWN_LOCAL_IMAGE_EXTENSION_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/iu;

export function isMarkdownLocalImagePath(value: string) {
  return MARKDOWN_LOCAL_IMAGE_EXTENSION_PATTERN.test(value);
}

export function transformTranscriptUrl(value: string) {
  return normalizeMarkdownLocalAssetPath(value) ? value : defaultUrlTransform(value);
}
