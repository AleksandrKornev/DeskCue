import { isRecord } from "../codexTranscriptShared.ts";

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

  return text
    .replace(/<oai-mem-citation>\s*[\s\S]*?<\/oai-mem-citation>/gi, "")
    .replace(directiveListItemPattern, "")
    .replace(directiveOnlyParenthesesPattern, "")
    .replace(directivePatternGlobal, "")
    .replace(/^\s*[-*]\s+`{0,2}\s*`{0,2}\s*$/gm, "")
    .replace(/\(\s*(?:,\s*)+\)/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isTurnAbortedMessage(value: string) {
  return /<turn_aborted>\s*[\s\S]*?\s*<\/turn_aborted>/i.test(value);
}
