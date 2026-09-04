export type CodexTranscriptJsonObjectScan = {
  closingBytes: number[];
  escaped: boolean;
  inString: boolean;
  invalid: boolean;
  rootClosed: boolean;
  rootStarted: boolean;
};

const MAX_JSON_NESTING_DEPTH = 256;

function isJsonWhitespaceByte(byte: number) {
  return byte === 9 || byte === 10 || byte === 13 || byte === 32;
}

export function createCodexTranscriptJsonObjectScan(): CodexTranscriptJsonObjectScan {
  return {
    closingBytes: [],
    escaped: false,
    inString: false,
    invalid: false,
    rootClosed: false,
    rootStarted: false
  };
}

export function appendCodexTranscriptJsonObjectBytes(
  scan: CodexTranscriptJsonObjectScan,
  chunk: Buffer
) {
  for (const byte of chunk) {
    if (scan.invalid) return;

    if (scan.rootClosed) {
      if (!isJsonWhitespaceByte(byte)) scan.invalid = true;

      continue;
    }

    if (scan.inString) {
      if (scan.escaped) {
        scan.escaped = false;
      } else if (byte === 92) {
        scan.escaped = true;
      } else if (byte === 34) {
        scan.inString = false;
      }

      continue;
    }

    if (byte === 34) {
      scan.inString = true;
      continue;
    }

    if (byte === 123 || byte === 91) {
      if (!scan.rootStarted) {
        if (byte !== 123) {
          scan.invalid = true;
          return;
        }

        scan.rootStarted = true;
      }

      if (scan.closingBytes.length >= MAX_JSON_NESTING_DEPTH) {
        scan.invalid = true;
        return;
      }

      scan.closingBytes.push(byte === 123 ? 125 : 93);
      continue;
    }

    if (byte === 125 || byte === 93) {
      if (scan.closingBytes.pop() !== byte) {
        scan.invalid = true;
        return;
      }

      if (scan.closingBytes.length === 0) scan.rootClosed = true;

      continue;
    }

    if (!scan.rootStarted && !isJsonWhitespaceByte(byte)) {
      scan.invalid = true;
    }
  }
}

export function isCompleteCodexTranscriptJsonObject(scan: CodexTranscriptJsonObjectScan) {
  return scan.rootStarted && scan.rootClosed && scan.closingBytes.length === 0 &&
    !scan.inString && !scan.invalid;
}

export function isValidCodexTranscriptJsonObjectText(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
