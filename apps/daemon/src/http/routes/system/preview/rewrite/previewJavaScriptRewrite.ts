const STATIC_ASSET_EXTENSION_PATTERN =
  /\.(?:svg|png|jpe?g|webp|gif|ico|css|[cm]?[jt]sx?|woff2?|ttf|otf|json|manifest|webmanifest)$/i;

const VITE_MODULE_PATH_PATTERN =
  /^\/(?:src\/|node_modules\/\.vite\/|@(?:vite|id|fs)\/|@react-refresh(?:\/|$))/;

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield"
]);

export const MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES = 12 * 1024 * 1024;

export type PreviewJavaScriptRewriteDiagnostics = {
  assetReplacements: number;
  evalModules: number;
  outputChunks: number;
  scannedCharacters: number;
};

export function isPreviewStaticAssetLiteral(value: string, basePath: string) {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/api/") ||
    value.startsWith(`${basePath}/`) ||
    value.length > 2_048 ||
    /[\\\r\n\0]/.test(value)
  ) {
    return false;
  }
  const pathname = value.split(/[?#]/, 1)[0];
  return STATIC_ASSET_EXTENSION_PATTERN.test(pathname) ||
    VITE_MODULE_PATH_PATTERN.test(pathname);
}

export function serializePreviewScriptString(value: string) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function isIdentifierStart(value: string) {
  const code = value.charCodeAt(0);
  return value === "$" || value === "_" ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122);
}

function isDigit(value: string) {
  const code = value.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isIdentifierPart(value: string) {
  return isIdentifierStart(value) || isDigit(value);
}

function isWhitespace(value: string) {
  return value === " " || value === "\n" || value === "\r" ||
    value === "\t" || value === "\v" || value === "\f";
}

function skipJavaScriptNumber(value: string, start: number) {
  let cursor = start + 1;
  while (cursor < value.length) {
    const character = value[cursor];
    if (isIdentifierPart(character) || character === ".") {
      cursor += 1;
      continue;
    }
    if ((character === "+" || character === "-") &&
      (value[cursor - 1] === "e" || value[cursor - 1] === "E")) {
      cursor += 1;
      continue;
    }
    break;
  }
  return cursor;
}

function findJavaScriptStringEnd(value: string, start: number, quote: string) {
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === quote) return index;
  }
  return -1;
}

function findJavaScriptRegexEnd(value: string, start: number) {
  let escaped = false;
  let characterClass = false;
  let cursor = start + 1;
  for (; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") characterClass = true;
    else if (character === "]") characterClass = false;
    else if (character === "/" && !characterClass) {
      cursor += 1;
      break;
    }
  }
  while (/[A-Za-z]/.test(value[cursor] ?? "")) cursor += 1;
  return cursor;
}

function rewriteDirectJavaScriptAssetLiterals(
  source: string,
  basePath: string,
  diagnostics: PreviewJavaScriptRewriteDiagnostics
) {
  const output: string[] = [];
  let copyStart = 0;
  let cursor = 0;
  let canStartRegex = true;
  diagnostics.scannedCharacters += source.length;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "/" && source[cursor + 1] === "/") {
      const end = source.indexOf("\n", cursor + 2);
      cursor = end < 0 ? source.length : end;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      const end = source.indexOf("*/", cursor + 2);
      const next = end < 0 ? source.length : end + 2;
      cursor = next;
      continue;
    }
    if (character === "/" && canStartRegex) {
      const end = findJavaScriptRegexEnd(source, cursor);
      cursor = end;
      canStartRegex = false;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      const end = findJavaScriptStringEnd(source, cursor, character);
      if (end < 0) {
        break;
      }
      const literal = source.slice(cursor + 1, end);
      if (isPreviewStaticAssetLiteral(literal, basePath)) {
        output.push(source.slice(copyStart, cursor + 1), `${basePath}${literal}`);
        copyStart = end;
        diagnostics.assetReplacements += 1;
        diagnostics.outputChunks += 2;
      }
      cursor = end + 1;
      canStartRegex = false;
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = cursor;
      cursor += 1;
      while (cursor < source.length && isIdentifierPart(source[cursor])) cursor += 1;
      const token = source.slice(start, cursor);
      canStartRegex = REGEX_PREFIX_KEYWORDS.has(token);
      continue;
    }
    if (isDigit(character)) {
      cursor = skipJavaScriptNumber(source, cursor);
      canStartRegex = false;
      continue;
    }
    if (!isWhitespace(character)) {
      canStartRegex = !/[\])}.]/.test(character);
    }
    cursor += 1;
  }
  if (output.length === 0) return source;
  output.push(source.slice(copyStart));
  diagnostics.outputChunks += 1;
  return output.join("");
}

function rewriteDecodedEvalAssets(
  value: string,
  basePath: string,
  diagnostics: PreviewJavaScriptRewriteDiagnostics
) {
  const withJavaScriptAssets = rewriteDirectJavaScriptAssetLiterals(
    value,
    basePath,
    diagnostics
  );
  return withJavaScriptAssets.replace(
    /url\(\s*(["']?)(\/[^)'"\s]+)\1\s*\)/gi,
    (match, quote: string, rawUrl: string) => {
      if (!isPreviewStaticAssetLiteral(rawUrl, basePath)) return match;
      diagnostics.assetReplacements += 1;
      diagnostics.outputChunks += 2;
      return `url(${quote}${basePath}${rawUrl}${quote})`;
    }
  );
}

function rewriteSerializedEvalArgument(
  call: string,
  serialized: string,
  basePath: string,
  diagnostics: PreviewJavaScriptRewriteDiagnostics
) {
  try {
    const decoded: unknown = JSON.parse(serialized);
    if (typeof decoded !== "string") return call;
    diagnostics.evalModules += 1;
    const rewritten = rewriteDecodedEvalAssets(decoded, basePath, diagnostics);
    return rewritten === decoded
      ? call
      : call.replace(serialized, serializePreviewScriptString(rewritten));
  } catch {
    return call;
  }
}

function rewriteEvalJavaScriptAssetLiterals(
  value: string,
  basePath: string,
  diagnostics: PreviewJavaScriptRewriteDiagnostics
) {
  const withNextWrappers = value.replace(
    /\beval\(\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.ts\(\s*("(?:\\.|[^"\\])*")\s*\)\s*\)/g,
    (call, serialized: string) => rewriteSerializedEvalArgument(
      call,
      serialized,
      basePath,
      diagnostics
    )
  );
  return withNextWrappers.replace(
    /\beval\(\s*("(?:\\.|[^"\\])*")\s*\)/g,
    (call, serialized: string) => rewriteSerializedEvalArgument(
      call,
      serialized,
      basePath,
      diagnostics
    )
  );
}

export function rewritePreviewJavaScriptAssetLiterals(
  body: Buffer,
  basePath: string,
  onDiagnostics?: (diagnostics: PreviewJavaScriptRewriteDiagnostics) => void
) {
  const diagnostics: PreviewJavaScriptRewriteDiagnostics = {
    assetReplacements: 0,
    evalModules: 0,
    outputChunks: 0,
    scannedCharacters: 0
  };
  const source = body.toString("utf8");
  const withDirectAssets = rewriteDirectJavaScriptAssetLiterals(
    source,
    basePath,
    diagnostics
  );
  const rewritten = rewriteEvalJavaScriptAssetLiterals(
    withDirectAssets,
    basePath,
    diagnostics
  );
  onDiagnostics?.({ ...diagnostics });
  return Buffer.from(rewritten, "utf8");
}
