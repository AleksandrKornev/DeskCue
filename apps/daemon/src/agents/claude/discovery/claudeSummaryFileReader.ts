import { open, readFile, stat } from "node:fs/promises";

const CLAUDE_SUMMARY_WINDOW_BYTES = 256 * 1024;
const CLAUDE_SUMMARY_FULL_READ_MAX_BYTES = CLAUDE_SUMMARY_WINDOW_BYTES * 2;

function splitCompleteLines(
  source: string,
  options: { dropLeadingPartial?: boolean; dropTrailingPartial?: boolean } = {}
) {
  const lines = source.split(/\r?\n/);
  if (options.dropLeadingPartial) lines.shift();
  if (options.dropTrailingPartial && !source.endsWith("\n")) lines.pop();
  return lines.map((line) => line.trim()).filter(Boolean);
}

export async function readClaudeSummaryFile(filePath: string) {
  const fileStat = await stat(filePath);
  if (fileStat.size <= CLAUDE_SUMMARY_FULL_READ_MAX_BYTES) {
    return {
      lines: splitCompleteLines(await readFile(filePath, "utf8")),
      mtimeMs: fileStat.mtimeMs
    };
  }

  const handle = await open(filePath, "r");
  try {
    const head = Buffer.alloc(CLAUDE_SUMMARY_WINDOW_BYTES);
    const tail = Buffer.alloc(CLAUDE_SUMMARY_WINDOW_BYTES);
    const tailOffset = fileStat.size - CLAUDE_SUMMARY_WINDOW_BYTES;
    const [headRead, tailRead] = await Promise.all([
      handle.read(head, 0, head.length, 0),
      handle.read(tail, 0, tail.length, tailOffset)
    ]);
    return {
      lines: [
        ...splitCompleteLines(head.subarray(0, headRead.bytesRead).toString("utf8"), {
          dropTrailingPartial: true
        }),
        ...splitCompleteLines(tail.subarray(0, tailRead.bytesRead).toString("utf8"), {
          dropLeadingPartial: true
        })
      ],
      mtimeMs: fileStat.mtimeMs
    };
  } finally {
    await handle.close();
  }
}
