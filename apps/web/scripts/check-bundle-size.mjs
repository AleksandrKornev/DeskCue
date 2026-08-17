import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_MAX_JAVASCRIPT_CHUNK_BYTES = 500_000;

async function listJavaScriptChunks(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const chunks = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      chunks.push(...await listJavaScriptChunks(path));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      chunks.push({ path, size: (await stat(path)).size });
    }
  }
  return chunks;
}

const outputDirectory = resolve(process.argv[2] ?? "dist");
const maxJavaScriptChunkBytes = Number(
  process.argv[3] ?? DEFAULT_MAX_JAVASCRIPT_CHUNK_BYTES
);
if (!Number.isSafeInteger(maxJavaScriptChunkBytes) || maxJavaScriptChunkBytes <= 0) {
  throw new Error("The JavaScript chunk budget must be a positive integer.");
}
const chunks = await listJavaScriptChunks(outputDirectory);
if (chunks.length === 0) {
  throw new Error(`No JavaScript chunks found in ${outputDirectory}.`);
}

const oversizedChunks = chunks.filter(({ size }) => size > maxJavaScriptChunkBytes);
if (oversizedChunks.length > 0) {
  const details = oversizedChunks
    .map(({ path, size }) => `${path}: ${size} bytes`)
    .join("\n");
  throw new Error(
    `JavaScript chunk budget exceeded (${maxJavaScriptChunkBytes} bytes):\n${details}`
  );
}

const largestChunk = chunks.reduce((largest, chunk) => (
  chunk.size > largest.size ? chunk : largest
));
console.log(
  `JavaScript chunk budget passed: largest chunk is ${largestChunk.size} bytes `
    + `(limit ${maxJavaScriptChunkBytes}).`
);
