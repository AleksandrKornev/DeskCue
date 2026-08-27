const gitPathEncoder = new TextEncoder();
const gitPathDecoder = new TextDecoder();

type GitDiffHeaderPaths = {
  newPath: string;
  oldPath: string;
};

type QuotedGitToken = {
  nextIndex: number;
  token: string;
};

const gitEscapeBytes: Readonly<Record<string, number>> = {
  "\"": 0x22,
  "\\": 0x5c,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b
};

function appendEncodedText(bytes: number[], value: string) {
  bytes.push(...gitPathEncoder.encode(value));
}

function readQuotedGitToken(value: string, startIndex = 0): QuotedGitToken | null {
  if (value[startIndex] !== "\"") return null;

  let escaped = false;

  for (let index = startIndex + 1; index < value.length; index += 1) {
    const character = value[index];

    if (character === "\"" && !escaped) {
      return {
        nextIndex: index + 1,
        token: value.slice(startIndex, index + 1)
      };
    }

    if (character === "\\" && !escaped) {
      escaped = true;
    } else {
      escaped = false;
    }
  }

  return null;
}

function stripGitDiffPrefix(path: string, prefix: "a/" | "b/") {
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

export function decodeGitDiffPathToken(value: string) {
  if (!value.startsWith("\"") || !value.endsWith("\"")) return value;

  const bytes: number[] = [];
  const content = value.slice(1, -1);

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character !== "\\") {
      appendEncodedText(bytes, character);
      continue;
    }

    const escaped = content[index + 1];

    if (escaped === undefined) {
      appendEncodedText(bytes, character);
      continue;
    }

    const mappedByte = gitEscapeBytes[escaped];

    if (mappedByte !== undefined) {
      bytes.push(mappedByte);
      index += 1;
      continue;
    }

    const octal = content.slice(index + 1).match(/^[0-7]{1,3}/)?.[0];

    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }

    appendEncodedText(bytes, escaped);
    index += 1;
  }

  return gitPathDecoder.decode(Uint8Array.from(bytes));
}

function parseQuotedGitDiffHeader(payload: string): GitDiffHeaderPaths | null {
  const oldToken = readQuotedGitToken(payload);

  if (!oldToken) return null;

  let newTokenStart = oldToken.nextIndex;

  while (payload[newTokenStart] === " ") newTokenStart += 1;
  const newToken = payload[newTokenStart] === "\""
    ? readQuotedGitToken(payload, newTokenStart)
    : { nextIndex: payload.length, token: payload.slice(newTokenStart) };
  if (!newToken || payload.slice(newToken.nextIndex).trim()) return null;

  const oldPath = stripGitDiffPrefix(decodeGitDiffPathToken(oldToken.token), "a/");
  const newPath = stripGitDiffPrefix(decodeGitDiffPathToken(newToken.token), "b/");

  return oldPath !== null && newPath !== null ? { newPath, oldPath } : null;
}

function parseUnquotedOldQuotedNewGitDiffHeader(payload: string): GitDiffHeaderPaths | null {
  const delimiterIndex = payload.indexOf(" \"b/");

  if (delimiterIndex < 0) return null;

  const newToken = readQuotedGitToken(payload, delimiterIndex + 1);

  if (!newToken || payload.slice(newToken.nextIndex).trim()) return null;

  const oldPath = stripGitDiffPrefix(payload.slice(0, delimiterIndex), "a/");
  const newPath = stripGitDiffPrefix(decodeGitDiffPathToken(newToken.token), "b/");

  return oldPath !== null && newPath !== null ? { newPath, oldPath } : null;
}

function parseUnquotedGitDiffHeader(payload: string): GitDiffHeaderPaths | null {
  let delimiterIndex = payload.indexOf(" b/");
  let fallback: GitDiffHeaderPaths | null = null;

  while (delimiterIndex >= 0) {
    const oldPath = payload.slice(0, delimiterIndex);
    const newPath = payload.slice(delimiterIndex + 3);
    const candidate = { newPath, oldPath };

    if (oldPath === newPath) return candidate;

    fallback = candidate;
    delimiterIndex = payload.indexOf(" b/", delimiterIndex + 1);
  }

  return fallback;
}

export function parseGitDiffHeaderPaths(line: string): GitDiffHeaderPaths | null {
  const prefix = "diff --git ";

  if (!line.startsWith(prefix)) return null;

  const payload = line.slice(prefix.length);

  if (payload.startsWith("\"")) return parseQuotedGitDiffHeader(payload);
  if (!payload.startsWith("a/")) return null;

  return parseUnquotedOldQuotedNewGitDiffHeader(payload) ?? parseUnquotedGitDiffHeader(payload.slice(2));
}
