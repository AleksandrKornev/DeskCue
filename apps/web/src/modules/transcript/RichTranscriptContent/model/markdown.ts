export function extractMarkdownCodeLanguage(className: string | undefined) {
  if (!className) {
    return "";
  }

  const match = className.match(/language-([\w-]+)/i);
  return match?.[1]?.toLowerCase() ?? "";
}

export function flattenMarkdownCodeChildren(children: unknown): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children).replace(/\n$/, "");
  }

  if (Array.isArray(children)) {
    return children
      .map((child) => flattenMarkdownCodeChildren(child))
      .join("")
      .replace(/\n$/, "");
  }

  return "";
}

export function normalizeTranscriptMarkdown(text: string) {
  const lines = text.split("\n");
  let activeOrderedIndent: number | null = null;
  let changed = false;

  const normalizedLines = lines.map((line) => {
    const orderedMatch = line.match(/^(\s*)\d+[.)]\s+\S/);
    if (orderedMatch) {
      activeOrderedIndent = orderedMatch[1]?.length ?? 0;
      return line;
    }

    if (activeOrderedIndent !== null) {
      if (/^\s{4,}[-*+]\s+\S/.test(line)) {
        return line;
      }

      const shallowBulletMatch = line.match(/^\s{1,3}[-*+]\s+\S/);
      if (shallowBulletMatch) {
        changed = true;
        return `${" ".repeat(activeOrderedIndent + 4)}${line.trimStart()}`;
      }
    }

    activeOrderedIndent = null;
    return line;
  });

  return changed ? normalizedLines.join("\n") : text;
}
