import { isRecord, truncate } from "../codexTranscriptShared.ts";

const REDACTION_PREVIEW_GUARD = 256;
const REDACTION_HINT_PATTERN =
  /\b\d{8,12}:[A-Za-z0-9_-]{20,}\b|\bdcd_|access_token|deskcueToken|token=|\b(?:Bearer|Token|Basic)\s+|"(?:accessToken|botToken|token|authorization|apiKey|secret)"\s*:/i;

export function buildToolCallSummary(toolName: string, namespace: string | null, _argumentsText: string | null) {
  const qualifiedToolName = namespace ? `${namespace}.${toolName}` : toolName;
  return `Called ${qualifiedToolName}`;
}

function mayContainTranscriptSecret(value: string) {
  return REDACTION_HINT_PATTERN.test(value);
}

export function redactTranscriptToolText(value: string) {
  if (!mayContainTranscriptSecret(value)) {
    return value;
  }

  return value
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g, "[redacted telegram token]")
    .replace(/\bdcd_[A-Za-z0-9_-]+\b/g, "[redacted access token]")
    .replace(
      /(\b(?:Bearer|Token|Basic)\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
      "$1[redacted]"
    )
    .replace(
      /([?&](?:access_token|deskcueToken|token)=)[^&#\s"'\\]+/gi,
      "$1[redacted]"
    )
    .replace(
      /("(?:accessToken|botToken|token|authorization|apiKey|secret)"\s*:\s*")[^"]+(")/gi,
      "$1[redacted]$2"
    );
}

export function redactTranscriptToolPreview(value: string, limit: number) {
  return truncate(
    redactTranscriptToolText(truncate(value, limit + REDACTION_PREVIEW_GUARD)),
    limit
  );
}

export function inferToolNameFromOutput(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/"tool":"([^"]+)"/);
  return match?.[1] ?? null;
}

export function normalizeMcpToolResult(value: unknown) {
  if (!isRecord(value) || !isRecord(value.Ok)) {
    return "";
  }

  const content = Array.isArray(value.Ok.content) ? value.Ok.content : [];
  return truncate(
    content
      .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text.trim() : ""))
      .filter(Boolean)
      .join("\n\n"),
    800
  );
}

function extractToolOutputText(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (!isRecord(value)) {
    return "";
  }

  for (const fieldName of ["text", "output_text", "content", "message"]) {
    const fieldValue = value[fieldName];
    if (typeof fieldValue === "string" && fieldValue.trim()) {
      return fieldValue.trim();
    }
  }

  return "";
}

export function normalizeToolOutput(value: unknown) {
  if (Array.isArray(value)) {
    return truncate(
      value
        .map((item) => extractToolOutputText(item))
        .filter(Boolean)
        .join("\n\n")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim(),
      800
    );
  }

  if (typeof value === "string") {
    return truncate(
      value
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim(),
      800
    );
  }

  return "";
}
