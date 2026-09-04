import { fromMarkdown } from "mdast-util-from-markdown";

import { normalizeWindowsMarkdownTargets } from "@deskcue/protocol/markdown";

type MarkdownSyntaxNode = {
  children?: MarkdownSyntaxNode[];
  identifier?: string;
  position?: {
    end: { line: number };
    start: { line: number };
  };

  type: string;
  url?: string;
};

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
  const normalizedTargets = normalizeWindowsMarkdownTargets(text);
  const lines = normalizedTargets.split("\n");
  let activeOrderedIndent: number | null = null;
  let changed = normalizedTargets !== text;

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

export function getMarkdownAssetSources(text: string) {
  const syntaxTree = fromMarkdown(normalizeTranscriptMarkdown(text)) as MarkdownSyntaxNode;
  const definitions = new Map<string, string>();
  const assetNodes: MarkdownSyntaxNode[] = [];
  const pendingNodes = [syntaxTree];

  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();

    if (!node) continue;

    if (node.type === "definition" && node.identifier && node.url) {
      definitions.set(node.identifier.toLowerCase(), node.url);
    } else if (
      node.type === "image" ||
      node.type === "imageReference" ||
      node.type === "link" ||
      node.type === "linkReference"
    ) {
      assetNodes.push(node);
    }

    if (!node.children) continue;

    for (const child of node.children) pendingNodes.push(child);
  }

  return assetNodes.flatMap((node) => {
    const source = node.url ?? (
      node.identifier ? definitions.get(node.identifier.toLowerCase()) : undefined
    );

    return source ? [source] : [];
  });
}
