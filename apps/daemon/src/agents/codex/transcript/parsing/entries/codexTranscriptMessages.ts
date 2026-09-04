import { getMarkdownCodeRanges } from "@deskcue/protocol/markdown";

import { isRecord } from "../codexTranscriptShared.ts";

type ResponseAnnotation = {
  annotation: string;
  sourceLength: number;
  text: string;
};

const MAX_RESPONSE_ANNOTATIONS = 50;
const MAX_RESPONSE_ANNOTATION_FIELD_LENGTH = 50_000;
const MAX_RESPONSE_ANNOTATIONS_JSON_LENGTH = 1_500_000;
const MAX_RESPONSE_ANNOTATIONS_TOTAL_LENGTH = 200_000;
const RESPONSE_ANNOTATION_ENVELOPE_PATTERN = new RegExp(
  String.raw`^\s*#+\s*Response annotations:\s*([\s\S]*?)` +
    String.raw`<response-annotations>([\s\S]*?)<\/response-annotations>` +
    String.raw`\s*#+\s*My request(?:\s+for Codex)?:\s*([\s\S]*)$`,
  "iu"
);
const RESPONSE_ANNOTATION_PREAMBLE_MARKERS = [
  "Each item contains text selected from an earlier Codex response",
  "Use every selection as context and address every comment"
];

function parseResponseAnnotation(value: unknown): ResponseAnnotation | null {
  if (!isRecord(value)) return null;
  if (typeof value.text !== "string") return null;
  if (value.annotation !== undefined && typeof value.annotation !== "string") return null;

  const sourceAnnotation = value.annotation ?? "";

  if (value.text.length > MAX_RESPONSE_ANNOTATION_FIELD_LENGTH) return null;
  if (sourceAnnotation.length > MAX_RESPONSE_ANNOTATION_FIELD_LENGTH) return null;

  const text = value.text.trim();
  const annotation = sourceAnnotation.trim();

  return text || annotation
    ? { annotation, sourceLength: value.text.length + sourceAnnotation.length, text }
    : null;
}

function escapeMarkdownText(value: string) {
  return value.replace(/([\\`*{}\[\]()<>#+\-.!_|])/gu, "\\$1");
}

function quoteMarkdown(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => `> ${escapeMarkdownText(line)}`)
    .join("\n");
}

function formatResponseAnnotations(annotations: ResponseAnnotation[]) {
  const items = annotations.map((annotation, index) => {
    const sections = [`**Annotation ${index + 1}**`];

    if (annotation.text) sections.push(quoteMarkdown(annotation.text));
    if (annotation.annotation) {
      sections.push(`**Comment:** ${escapeMarkdownText(annotation.annotation)}`);
    }

    return sections.join("\n\n");
  });

  return `### Response annotations\n\n${items.join("\n\n")}`;
}

function overlapsMarkdownCodeRange(start: number, end: number, ranges: { end: number; start: number }[]) {
  return ranges.some((range) => start < range.end && end > range.start);
}

function stripResponseAnnotationDirectives(text: string) {
  if (!text.includes(":codex-annotation{")) return text;

  const codeRanges = getMarkdownCodeRanges(text);
  const directivePattern = /(?:^[ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d+[.)]|#{1,6})[ \t]+))*|[ \t]+):codex-annotation\{index=(?:"\d+"|'\d+'|\d+)\}[ \t]*(?=\r?$)/gmu;

  return text.replace(directivePattern, (match, offset: number) => {
    const directiveOffset = match.search(/:codex-annotation/u);
    const start = offset + directiveOffset;
    const end = offset + match.length;

    return overlapsMarkdownCodeRange(start, end, codeRanges) ? match : "";
  });
}

function isResponseAnnotationTransportPreamble(value: string) {
  return RESPONSE_ANNOTATION_PREAMBLE_MARKERS.every((marker) => value.includes(marker));
}

function unwrapResponseAnnotationEnvelope(text: string) {
  const match = text.match(RESPONSE_ANNOTATION_ENVELOPE_PATTERN);

  if (!match) return null;
  if (!isResponseAnnotationTransportPreamble(match[1])) return null;
  if (match[2].length > MAX_RESPONSE_ANNOTATIONS_JSON_LENGTH) return null;

  let parsed: unknown;

  try {
    parsed = JSON.parse(match[2]);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;
  if (parsed.length > MAX_RESPONSE_ANNOTATIONS) return null;

  const annotations: ResponseAnnotation[] = [];
  let annotationsLength = 0;

  for (const value of parsed) {
    const annotation = parseResponseAnnotation(value);

    if (!annotation) return null;

    annotationsLength += annotation.sourceLength;
    if (annotationsLength > MAX_RESPONSE_ANNOTATIONS_TOTAL_LENGTH) return null;

    annotations.push(annotation);
  }

  const request = match[3]?.trim() ?? "";

  if (annotations.length === 0) return request || null;

  const formattedAnnotations = formatResponseAnnotations(annotations);

  return request
    ? `${request}\n\n${formattedAnnotations}`
    : formattedAnnotations;
}

export function extractMessageText(content: unknown) {
  if (!Array.isArray(content)) return "";

  return content
    .map((chunk) => {
      if (!isRecord(chunk)) return "";
      if (typeof chunk.text === "string") return chunk.text;

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function extractExternalCodexDelegationInput(text: string) {
  const match = text.trim().match(
    /^<codex_delegation>\s*(?:<source_thread_id>[\s\S]*?<\/source_thread_id>\s*)?<input>\s*([\s\S]*?)\s*<\/input>\s*<\/codex_delegation>$/i
  );

  return match?.[1]?.trim() || null;
}

function stripInjectedCodexUserContext(text: string) {
  let normalized = text.trim();

  for (let index = 0; index < 8; index += 1) {
    const previous = normalized;

    normalized = normalized
      .replace(/^<recommended_plugins>[\s\S]*?<\/recommended_plugins>\s*/i, "")
      .replace(
        /^(?:#+\s*)?AGENTS\.md instructions for [^\n]*\n\s*<INSTRUCTIONS\b[^>]*>[\s\S]*?<\/INSTRUCTIONS>\s*/i,
        ""
      )
      .replace(/^<INSTRUCTIONS\b[^>]*>[\s\S]*?<\/INSTRUCTIONS>\s*/i, "")
      .replace(/^<environment_context>[\s\S]*?<\/environment_context>\s*/i, "")
      .trim();

    if (normalized === previous) break;
  }

  return normalized;
}

export function normalizeUserMessageText(text: string, payload: Record<string, unknown>) {
  if (!text) return text;

  const hasImageAttachments =
    (Array.isArray(payload.images) && payload.images.length > 0) ||
    (Array.isArray(payload.local_images) && payload.local_images.length > 0);

  const withoutInlineImageMarkup = text
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, "")
    .trim();
  const withoutInjectedContext = stripInjectedCodexUserContext(withoutInlineImageMarkup);
  const annotationMessage = unwrapResponseAnnotationEnvelope(withoutInjectedContext);

  if (annotationMessage !== null) return annotationMessage;

  const codexAppWrapperMatch = withoutInjectedContext.match(
    /(?:^|\n)#+\s*Files mentioned by the user:\s*[\s\S]*?(?:^|\n)#+\s*My request(?:\s+for Codex)?:\s*([\s\S]*)$/im
  );

  if (codexAppWrapperMatch) {
    const requestText = codexAppWrapperMatch[1]?.trim() ?? "";

    if (requestText) return requestText;
  }

  if (hasImageAttachments) {
    const lines = withoutInjectedContext
      .split(/\r?\n/)
      .map((line) => line.trimEnd());
    const requestIndex = lines.findIndex((line) =>
      /^#+\s*My request(?:\s+for Codex)?:\s*$/i.test(line.trim())
    );

    if (requestIndex >= 0) {
      const requestText = lines.slice(requestIndex + 1).join("\n").trim();

      if (requestText) return requestText;
    }
  }

  return withoutInjectedContext;
}

export function normalizeAssistantMessageText(text: string) {
  const directivePattern = String.raw`::(?:code-comment|created-thread|git-(?:[a-z-]+|\*))\{[^}]*\}`;
  const directiveListItemPattern = new RegExp(
    String.raw`^\s*[-*]\s+` + String.raw`(?:` + "`" + `)?${directivePattern}(?:` + "`" + String.raw`)?\s*$`,
    "gm"
  );
  const directiveOnlyParenthesesPattern = new RegExp(
    String.raw`\(\s*(?:(?:` + "`" + `)?${directivePattern}(?:` + "`" + String.raw`)?\s*,?\s*)+\)`,
    "g"
  );
  const directivePatternGlobal = new RegExp(directivePattern, "g");

  return stripResponseAnnotationDirectives(text)
    .replace(/<oai-mem-citation>\s*[\s\S]*?<\/oai-mem-citation>/gi, "")
    .replace(directiveListItemPattern, "")
    .replace(directiveOnlyParenthesesPattern, "")
    .replace(directivePatternGlobal, "")
    .replace(/^\s*[-*]\s+`{0,2}\s*`{0,2}\s*$/gm, "")
    .replace(/\(\s*(?:,\s*)+\)/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isTurnAbortedMessage(value: string) {
  return /<turn_aborted>\s*[\s\S]*?\s*<\/turn_aborted>/i.test(value);
}
