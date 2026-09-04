import { fromMarkdown } from "mdast-util-from-markdown";

const MARKDOWN_FENCE_OPEN_PATTERN = /^ {0,3}(`{3,})([^`]*)$|^ {0,3}(~{3,}).*$/u;
const MARKDOWN_FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})\s*$/u;
const MARKDOWN_BLOCK_CODE_CANDIDATE_PATTERN = /^[^[]*(?: {4}|\t)[^[]*\[/u;
const MARKDOWN_WINDOWS_TARGET_PATTERN = /\]\(<?[A-Za-z]:\\/u;
const MAX_MARKDOWN_SYNTAX_CONTEXT_LINE_LENGTH = 4_096;
const MAX_MARKDOWN_SYNTAX_CONTEXT_CHARS = 262_144;
const MAX_MARKDOWN_SYNTAX_CONTEXT_GROUPS = 512;
const MAX_MARKDOWN_SYNTAX_NONUNIFORM_GROUP_LINES = 1_024;
const MAX_MARKDOWN_SYNTAX_PREVIOUS_LINES = 64;
const MARKDOWN_LINK_TITLE_PATTERN = /^\s*(?:(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\([^)]*\))\s*)?$/u;
const RAW_MARKDOWN_LINK_TITLE_PATTERN = /^(.*?)(\s+(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\([^)]*\)))\s*$/u;
const INLINE_CODE_TOKEN_PREFIX = "\u0000deskcue-code-span-";
const INLINE_CODE_TOKEN_SUFFIX = "\u0000";
const INLINE_CODE_TOKEN_PATTERN = new RegExp(
  `${INLINE_CODE_TOKEN_PREFIX}(\\d+)${INLINE_CODE_TOKEN_SUFFIX}`,
  "gu"
);

function stripWindowsSourcePosition(value: string) {
  return value.replace(/^(.*\.[^\\/:]+):\d+(?::\d+)?$/u, "$1");
}

function decodeLocalAssetPathOnce(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripLocalAssetUrlSuffix(value: string) {
  return value.split(/[?#]/u, 1)[0] ?? value;
}

export function normalizeMarkdownLocalAssetPath(value: string) {
  if (!value) return null;

  const candidate = stripLocalAssetUrlSuffix(value);
  let localPath: string;

  if (/^file:\/\/\/[A-Za-z]:\//u.test(candidate)) {
    localPath = candidate.replace(/^file:\/\/\//u, "");
  } else if (/^file:\/\//u.test(candidate)) {
    localPath = candidate.replace(/^file:\/\//u, "");
  } else if (/^\/[A-Za-z]:[\\/]/u.test(candidate)) {
    localPath = candidate.slice(1);
  } else if (/^[A-Za-z]:[\\/]/u.test(candidate) || /^\/[^/]/u.test(candidate)) {
    localPath = candidate;
  } else {
    return null;
  }

  const decodedPath = decodeLocalAssetPathOnce(localPath);

  return /^[A-Za-z]:[\\/]/u.test(decodedPath)
    ? stripWindowsSourcePosition(decodedPath)
    : decodedPath;
}

type MarkdownTargetBounds = {
  closingEnd: number;
  suffix: string;
  targetEnd: number;
};

type MarkdownQuotedTitleState = {
  delimiter: "\"" | "'";
  opening: number;
};

type MarkdownParenthesisPass = {
  closures: Map<number, number>;
  validContextOpenings: Set<number>;
};

type MarkdownTargetContextState = {
  phase:
    | "after_destination"
    | "after_title"
    | "angle"
    | "invalid"
    | "parenthesized_title"
    | "quote";
};

type MarkdownParenthesizedTitleState = {
  linkOpening: number;
  titleOpening: number;
};

type MarkdownSyntaxNode = {
  children?: MarkdownSyntaxNode[];
  identifier?: string;
  position?: {
    end: { line: number; offset?: number };
    start: { line: number; offset?: number };
  };

  type: string;
  url?: string;
};

export type MarkdownSourceRange = {
  end: number;
  start: number;
};

export function getMarkdownCodeRanges(markdown: string): MarkdownSourceRange[] {
  const syntaxTree = fromMarkdown(markdown) as MarkdownSyntaxNode;
  const ranges: MarkdownSourceRange[] = [];
  const pendingNodes = [syntaxTree];

  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();

    if (!node) continue;

    const start = node.position?.start.offset;
    const end = node.position?.end.offset;

    if ((node.type === "code" || node.type === "inlineCode") && start !== undefined && end !== undefined) {
      ranges.push({ end, start });
    }

    if (!node.children) continue;

    for (const child of node.children) pendingNodes.push(child);
  }

  return ranges.sort((left, right) => left.start - right.start);
}

function isMarkdownBlockCodeCandidate(line: string) {
  return MARKDOWN_BLOCK_CODE_CANDIDATE_PATTERN.test(line) &&
    MARKDOWN_WINDOWS_TARGET_PATTERN.test(line);
}

function readMarkdownBlockCodeCandidatePrefix(line: string) {
  const labelOpening = line.indexOf("[");

  return labelOpening < 0 ? line : line.slice(0, labelOpening);
}

function addMarkdownSourceLineRange(lines: Set<number>, start: number, end: number) {
  for (let line = start; line <= end; line += 1) lines.add(line);
}

function startsMarkdownTopLevelBlock(line: string) {
  return Boolean(line.trim()) && !/^[ \t]/u.test(line);
}

function readMarkdownPreviousContextLines(sourceLines: string[], groupStart: number) {
  const contextLines: string[] = [];
  let contextChars = 0;

  for (let index = groupStart - 1; index >= 0; index -= 1) {
    const line = sourceLines[index] ?? "";

    if (
      contextLines.length >= MAX_MARKDOWN_SYNTAX_PREVIOUS_LINES ||
      contextChars + line.length > MAX_MARKDOWN_SYNTAX_CONTEXT_LINE_LENGTH
    ) return null;

    contextLines.unshift(line);
    contextChars += line.length;

    const nextLine = sourceLines[index + 1] ?? "";

    if (!line.trim() && startsMarkdownTopLevelBlock(nextLine)) return contextLines;
  }

  return contextLines;
}

function collectMarkdownBlockCodeLines(text: string) {
  const codeLines = new Set<number>();
  const contextLines: string[] = [];
  const sourceLinesByContextLine: Array<number[] | null> = [];
  const sourceLines = text.split("\n");
  let contextChars = 0;
  let contextGroups = 0;

  for (let index = 0; index < sourceLines.length; index += 1) {
    if (!isMarkdownBlockCodeCandidate(sourceLines[index] ?? "")) continue;

    const groupStart = index;

    while (
      index + 1 < sourceLines.length &&
      isMarkdownBlockCodeCandidate(sourceLines[index + 1] ?? "")
    ) index += 1;

    const firstLine = sourceLines[groupStart] ?? "";
    const firstPrefix = readMarkdownBlockCodeCandidatePrefix(firstLine);
    const hasUniformPrefix = sourceLines
      .slice(groupStart, index + 1)
      .every((line) => readMarkdownBlockCodeCandidatePrefix(line) === firstPrefix);
    const groupSize = index - groupStart + 1;
    const previousContextLines = readMarkdownPreviousContextLines(sourceLines, groupStart);

    if (!previousContextLines) {
      addMarkdownSourceLineRange(codeLines, groupStart + 1, index + 1);
      continue;
    }

    const candidateContextLines = hasUniformPrefix
      ? [firstLine.slice(0, MAX_MARKDOWN_SYNTAX_CONTEXT_LINE_LENGTH)]
      : sourceLines
        .slice(groupStart, index + 1)
        .map((line) => line.slice(0, MAX_MARKDOWN_SYNTAX_CONTEXT_LINE_LENGTH));
    const nextContextChars = previousContextLines.reduce((total, line) => total + line.length, 0) +
      candidateContextLines.reduce((total, line) => total + line.length, 0);

    if (
      contextGroups >= MAX_MARKDOWN_SYNTAX_CONTEXT_GROUPS ||
      contextChars + nextContextChars > MAX_MARKDOWN_SYNTAX_CONTEXT_CHARS ||
      (!hasUniformPrefix && groupSize > MAX_MARKDOWN_SYNTAX_NONUNIFORM_GROUP_LINES)
    ) {
      addMarkdownSourceLineRange(codeLines, groupStart + 1, index + 1);
      continue;
    }

    for (const previousContextLine of previousContextLines) {
      contextLines.push(previousContextLine);
      sourceLinesByContextLine.push(null);
    }

    if (hasUniformPrefix) {
      const representedSourceLines = Array.from(
        { length: groupSize },
        (_, offset) => groupStart + offset + 1
      );

      contextLines.push(candidateContextLines[0] ?? "");
      sourceLinesByContextLine.push(representedSourceLines);
    } else {
      for (let offset = 0; offset < candidateContextLines.length; offset += 1) {
        contextLines.push(candidateContextLines[offset] ?? "");
        sourceLinesByContextLine.push([groupStart + offset + 1]);
      }
    }

    contextLines.push("", "");
    sourceLinesByContextLine.push(null, null);
    contextChars += nextContextChars;
    contextGroups += 1;
  }

  if (contextLines.length === 0) return codeLines;

  const syntaxTree = fromMarkdown(contextLines.join("\n")) as MarkdownSyntaxNode;
  const pendingNodes = [syntaxTree];

  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop();

    if (!node) continue;

    if (node.type === "code" && node.position) {
      for (let line = node.position.start.line; line <= node.position.end.line; line += 1) {
        const mappedSourceLines = sourceLinesByContextLine[line - 1];

        if (!mappedSourceLines) continue;

        for (const sourceLine of mappedSourceLines) codeLines.add(sourceLine);
      }
    }

    if (!node.children) continue;

    for (const child of node.children) pendingNodes.push(child);
  }

  return codeLines;
}

function getMarkdownFenceOpeningRun(line: string) {
  const match = line.match(MARKDOWN_FENCE_OPEN_PATTERN);

  return match?.[1] ?? match?.[3] ?? null;
}

function isMarkdownCharacterEscaped(text: string, index: number) {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function collectMarkdownLinkClosingBrackets(text: string) {
  const closingBrackets = new Set<number>();
  const openingBrackets: number[] = [];
  let backslashRun = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\\") {
      backslashRun += 1;
      continue;
    }

    const escaped = backslashRun % 2 === 1;

    backslashRun = 0;
    if (escaped) continue;

    if (character === "[") {
      openingBrackets.push(index);
      continue;
    }

    if (character === "]" && openingBrackets.length > 0) {
      openingBrackets.pop();
      closingBrackets.add(index);
    }
  }

  return closingBrackets;
}

function collectMarkdownParenthesisClosuresPass(
  text: string,
  provenValidContextOpenings?: Set<number>
): MarkdownParenthesisPass {
  const activeLinkOpenings: number[] = [];
  const closures = new Map<number, number>();
  const openings: number[] = [];
  const suspendedAngleByLinkOpening = new Map<number, number>();
  const suspendedParenthesizedByLinkOpening = new Map<
    number,
    MarkdownParenthesizedTitleState
  >();
  const suspendedQuoteByLinkOpening = new Map<number, MarkdownQuotedTitleState>();
  const targetContextStates = new Map<number, MarkdownTargetContextState>();
  const validContextOpenings = new Set<number>();
  let angleDestinationOpening: number | null = null;
  let escaped = false;
  let parenthesizedTitle: MarkdownParenthesizedTitleState | null = null;
  let quotedTitle: MarkdownQuotedTitleState | null = null;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      activeLinkOpenings.length = 0;
      angleDestinationOpening = null;
      escaped = false;
      openings.length = 0;
      parenthesizedTitle = null;
      quotedTitle = null;
      continue;
    }

    const escapedTailOpening = activeLinkOpenings.at(-1);
    const escapedTailContext = escapedTailOpening === undefined
      ? undefined
      : targetContextStates.get(escapedTailOpening);

    if (
      (escaped || text[index] === "\\") &&
      (escapedTailContext?.phase === "after_destination" ||
        escapedTailContext?.phase === "after_title")
    ) escapedTailContext.phase = "invalid";

    if (escaped) {
      escaped = false;
      continue;
    }

    if (text[index] === "\\") {
      escaped = true;
      continue;
    }

    if (angleDestinationOpening !== null) {
      const suspendedAngleOpening = angleDestinationOpening;
      const angleContext = targetContextStates.get(suspendedAngleOpening);

      if (text[index] === "<" && angleContext) angleContext.phase = "invalid";

      if (text[index] === ">") {
        angleDestinationOpening = null;
        if (angleContext?.phase !== "invalid") {
          targetContextStates.set(suspendedAngleOpening, { phase: "after_destination" });
        }
      }

      if (text[index] === "(" && text[index - 1] === "]") {
        if (
          !provenValidContextOpenings ||
          provenValidContextOpenings.has(suspendedAngleOpening)
        ) continue;

        activeLinkOpenings.push(index);
        openings.push(index);
        suspendedAngleByLinkOpening.set(index, suspendedAngleOpening);
        angleDestinationOpening = null;
      }

      continue;
    }

    if (quotedTitle) {
      const suspendedQuote = quotedTitle;

      if (text[index] === quotedTitle.delimiter) {
        quotedTitle = null;
        targetContextStates.set(suspendedQuote.opening, { phase: "after_title" });
      }

      if (text[index] === "(" && text[index - 1] === "]") {
        if (
          !provenValidContextOpenings ||
          provenValidContextOpenings.has(suspendedQuote.opening)
        ) continue;

        activeLinkOpenings.push(index);
        openings.push(index);
        suspendedQuoteByLinkOpening.set(index, suspendedQuote);
        quotedTitle = null;
      }

      continue;
    }

    if (parenthesizedTitle) {
      const suspendedParenthesizedTitle = parenthesizedTitle;

      if (text[index] === ")") {
        const titleOpening = openings.pop();

        if (titleOpening === parenthesizedTitle.titleOpening) {
          closures.set(titleOpening, index);
          parenthesizedTitle = null;
          targetContextStates.set(
            suspendedParenthesizedTitle.linkOpening,
            { phase: "after_title" }
          );
        }

        continue;
      }

      if (text[index] === "(" && text[index - 1] === "]") {
        if (
          !provenValidContextOpenings ||
          provenValidContextOpenings.has(suspendedParenthesizedTitle.linkOpening)
        ) continue;

        activeLinkOpenings.push(index);
        openings.push(index);
        suspendedParenthesizedByLinkOpening.set(index, suspendedParenthesizedTitle);
        parenthesizedTitle = null;
      }

      continue;
    }

    const activeLinkOpening = activeLinkOpenings.at(-1);
    const activeContext = activeLinkOpening === undefined
      ? undefined
      : targetContextStates.get(activeLinkOpening);

    if (
      activeContext &&
      (activeContext.phase === "after_destination" || activeContext.phase === "after_title")
    ) {
      const isOuterClose = text[index] === ")" && openings.at(-1) === activeLinkOpening;
      const isQuotedTitleStart =
        activeContext.phase === "after_destination" &&
        (text[index] === "\"" || text[index] === "'") &&
        /\s/u.test(text[index - 1] ?? "");
      const isParenthesizedTitleStart =
        activeContext.phase === "after_destination" &&
        text[index] === "(" &&
        /\s/u.test(text[index - 1] ?? "");

      if (
        !/\s/u.test(text[index] ?? "") &&
        !isOuterClose &&
        !isParenthesizedTitleStart &&
        !isQuotedTitleStart
      ) {
        activeContext.phase = "invalid";
      }
    }

    if (
      (text[index] === "\"" || text[index] === "'") &&
      activeLinkOpenings.length > 0 &&
      /\s/u.test(text[index - 1] ?? "")
    ) {
      const opening = activeLinkOpenings.at(-1) ?? -1;
      const context = targetContextStates.get(opening);

      if (context && context.phase !== "after_destination") continue;

      targetContextStates.set(opening, { phase: "quote" });
      quotedTitle = {
        delimiter: text[index] as "\"" | "'",
        opening
      };

      continue;
    }

    if (
      text[index] === "(" &&
      activeLinkOpenings.length > 0 &&
      /\s/u.test(text[index - 1] ?? "")
    ) {
      const linkOpening = activeLinkOpenings.at(-1) ?? -1;
      const context = targetContextStates.get(linkOpening);

      if (!context || context.phase === "after_destination") {
        targetContextStates.set(linkOpening, { phase: "parenthesized_title" });
        parenthesizedTitle = { linkOpening, titleOpening: index };
        openings.push(index);
        continue;
      }
    }

    if (text[index] === "(") {
      if (text[index - 1] === "]") activeLinkOpenings.push(index);

      openings.push(index);
      continue;
    }

    const activeOpening = openings.at(-1);

    if (
      text[index] === "<" &&
      activeOpening === index - 1 &&
      text[index - 2] === "]"
    ) {
      targetContextStates.set(activeOpening, { phase: "angle" });
      angleDestinationOpening = activeOpening;
      continue;
    }

    if (text[index] !== ")" || openings.length === 0) continue;

    const openingIndex = openings.pop();

    if (openingIndex === undefined) continue;

    closures.set(openingIndex, index);
    const closedContext = targetContextStates.get(openingIndex);

    if (
      closedContext?.phase === "after_destination" ||
      closedContext?.phase === "after_title"
    ) validContextOpenings.add(openingIndex);

    if (activeLinkOpenings.at(-1) === openingIndex) activeLinkOpenings.pop();

    angleDestinationOpening = suspendedAngleByLinkOpening.get(openingIndex)
      ?? angleDestinationOpening;
    quotedTitle = suspendedQuoteByLinkOpening.get(openingIndex) ?? quotedTitle;
    parenthesizedTitle = suspendedParenthesizedByLinkOpening.get(openingIndex)
      ?? parenthesizedTitle;
  }

  return { closures, validContextOpenings };
}

function findAngleMarkdownTargetBounds(
  text: string,
  targetStart: number,
  closingIndex: number
): MarkdownTargetBounds | null {
  let targetEnd = -1;

  for (let index = targetStart; index < closingIndex; index += 1) {
    if (text[index] === "<") return null;
    if (text[index] !== ">") continue;

    targetEnd = index;
    break;
  }

  if (targetEnd < 0 || targetEnd >= closingIndex) return null;

  const suffix = text.slice(targetEnd + 1, closingIndex);

  if (!MARKDOWN_LINK_TITLE_PATTERN.test(suffix)) return null;

  return { closingEnd: closingIndex + 1, suffix, targetEnd };
}

function splitRawMarkdownTarget(value: string) {
  const titleMatch = value.match(RAW_MARKDOWN_LINK_TITLE_PATTERN);

  if (!titleMatch?.[1] || !titleMatch[2]) return { suffix: "", target: value };

  return { suffix: titleMatch[2], target: titleMatch[1] };
}

function isRawMarkdownTargetContextValid(value: string) {
  if (!/\s+["'(]/u.test(value)) return true;

  return Boolean(splitRawMarkdownTarget(value).suffix);
}

function collectMarkdownParenthesisClosures(text: string) {
  const strictPass = collectMarkdownParenthesisClosuresPass(text);

  return collectMarkdownParenthesisClosuresPass(
    text,
    strictPass.validContextOpenings
  );
}

function normalizeWindowsMarkdownTargetsInText(text: string) {
  const markdownLinkClosingBrackets = collectMarkdownLinkClosingBrackets(text);
  const markdownParenthesisPass = collectMarkdownParenthesisClosures(text);
  let cursor = 0;
  let normalizedText = "";
  let searchFrom = 0;

  while (true) {
    const openingIndex = text.indexOf("](", searchFrom);

    if (openingIndex < 0) break;

    const candidateStart = openingIndex + 2;

    if (!markdownLinkClosingBrackets.has(openingIndex)) {
      searchFrom = candidateStart;
      continue;
    }

    const isAngleTarget = text[candidateStart] === "<";
    const targetStart = candidateStart + (isAngleTarget ? 1 : 0);
    const parenthesisOpening = openingIndex + 1;
    const closingIndex = markdownParenthesisPass.closures.get(parenthesisOpening) ?? -1;

    if (!/^[A-Za-z]:\\/u.test(text.slice(targetStart))) {
      searchFrom = candidateStart;
      continue;
    }

    const angleBounds = isAngleTarget && closingIndex >= 0
      ? findAngleMarkdownTargetBounds(text, targetStart, closingIndex)
      : null;
    const rawTargetEnd = isAngleTarget ? -1 : closingIndex;

    if (!angleBounds && rawTargetEnd < 0) {
      searchFrom = candidateStart;
      continue;
    }

    const targetEnd = angleBounds?.targetEnd ?? rawTargetEnd;
    const rawTargetValue = text.slice(targetStart, targetEnd);

    const rawHasTitleSyntax = /\s+["'(]/u.test(rawTargetValue);

    if (
      !isAngleTarget &&
      (!isRawMarkdownTargetContextValid(rawTargetValue) ||
        (rawHasTitleSyntax &&
          !markdownParenthesisPass.validContextOpenings.has(parenthesisOpening)))
    ) {
      searchFrom = candidateStart;
      continue;
    }

    const rawTarget = splitRawMarkdownTarget(rawTargetValue);
    const suffix = angleBounds?.suffix ?? rawTarget.suffix;
    const target = rawTarget.target.replaceAll("\\", "/");

    normalizedText += text.slice(cursor, candidateStart);
    normalizedText += `</${target}>${suffix})`;
    cursor = angleBounds?.closingEnd ?? targetEnd + 1;
    searchFrom = cursor;
  }

  normalizedText += text.slice(cursor);

  return normalizedText;
}

function normalizeWindowsMarkdownTargetsOutsideInlineCode(text: string) {
  const backtickRunPattern = /`+/gu;
  const protectedSpans: string[] = [];
  let cursor = 0;
  let maskedText = "";

  while (true) {
    const openingRun = backtickRunPattern.exec(text);

    if (!openingRun) break;
    if (isMarkdownCharacterEscaped(text, openingRun.index)) continue;

    let closingRun: RegExpExecArray | null = null;

    while (true) {
      const candidate = backtickRunPattern.exec(text);

      if (!candidate || candidate[0].length === openingRun[0].length) {
        closingRun = candidate;
        break;
      }
    }

    if (!closingRun) break;

    const closingEnd = closingRun.index + closingRun[0].length;
    const token = `${INLINE_CODE_TOKEN_PREFIX}${protectedSpans.length}${INLINE_CODE_TOKEN_SUFFIX}`;

    maskedText += text.slice(cursor, openingRun.index);
    maskedText += token;
    protectedSpans.push(text.slice(openingRun.index, closingEnd));
    cursor = closingEnd;
  }

  maskedText += text.slice(cursor);

  return normalizeWindowsMarkdownTargetsInText(maskedText).replace(
    INLINE_CODE_TOKEN_PATTERN,
    (token, index: string) => protectedSpans[Number(index)] ?? token
  );
}

function appendNormalizedProseLines(outputLines: string[], proseLines: string[]) {
  if (proseLines.length === 0) return;

  const normalizedLines = normalizeWindowsMarkdownTargetsOutsideInlineCode(
    proseLines.join("\n")
  ).split("\n");

  for (const line of normalizedLines) outputLines.push(line);

  proseLines.length = 0;
}

export function normalizeWindowsMarkdownTargets(text: string) {
  const blockCodeLines = collectMarkdownBlockCodeLines(text);
  const outputLines: string[] = [];
  const proseLines: string[] = [];
  let activeFence: { character: string; length: number } | null = null;
  let lineNumber = 0;

  for (const line of text.split("\n")) {
    lineNumber += 1;
    const fenceRun: string | null = activeFence
      ? line.match(MARKDOWN_FENCE_CLOSE_PATTERN)?.[1] ?? null
      : getMarkdownFenceOpeningRun(line);

    if (activeFence) {
      if (
        fenceRun?.[0] === activeFence.character
        && fenceRun.length >= activeFence.length
      ) {
        activeFence = null;
      }

      outputLines.push(line);
      continue;
    }

    if (blockCodeLines.has(lineNumber)) {
      appendNormalizedProseLines(outputLines, proseLines);
      outputLines.push(line);
      continue;
    }

    if (fenceRun) {
      appendNormalizedProseLines(outputLines, proseLines);
      activeFence = {
        character: fenceRun[0] ?? "",
        length: fenceRun.length
      };

      outputLines.push(line);
      continue;
    }

    proseLines.push(line);
  }

  appendNormalizedProseLines(outputLines, proseLines);

  return outputLines.join("\n");
}

export function getMarkdownAuthoredAssetSources(markdown: string) {
  const syntaxTree = fromMarkdown(normalizeWindowsMarkdownTargets(markdown)) as MarkdownSyntaxNode;
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
