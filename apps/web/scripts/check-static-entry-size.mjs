import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

import { init, parse } from "es-module-lexer";

const DEFAULT_MAX_RAW_BYTES = 110_000;
const DEFAULT_MAX_GZIP_BYTES = 30_000;

function readPositiveInteger(value, fallback, label) {
  const parsed = Number(value ?? fallback);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function resolveLocalJavaScriptImport(importerPath, specifier, outputDirectory) {
  if (!specifier.startsWith(".")) return null;

  const targetPath = resolve(dirname(importerPath), specifier);
  const relativeTarget = relative(outputDirectory, targetPath);

  if (
    isAbsolute(relativeTarget) ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    throw new Error(`Static entry import escapes the output directory: ${specifier}`);
  }

  if (!targetPath.endsWith(".js")) return null;

  return targetPath;
}

async function collectStaticEntryGraph(entryPath, outputDirectory) {
  const pending = [entryPath];
  const files = new Map();

  await init;

  while (pending.length > 0) {
    const path = pending.pop();

    if (!path || files.has(path)) continue;

    const bytes = await readFile(path);
    const source = bytes.toString("utf8");

    files.set(path, bytes);

    const [imports] = parse(source);
    for (const imported of imports) {
      if (imported.d !== -1) continue;

      const specifier = source.slice(imported.s, imported.e);
      const targetPath = resolveLocalJavaScriptImport(path, specifier, outputDirectory);

      if (targetPath && !files.has(targetPath)) pending.push(targetPath);
    }
  }

  return files;
}

async function resolveEntryPath(outputDirectory, entryName) {
  if (entryName.endsWith(".js")) return resolve(outputDirectory, entryName);

  const matches = (await readdir(outputDirectory))
    .filter((name) => name.startsWith(`${entryName}-`) && name.endsWith(".js"));

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${entryName}-*.js entry in ${outputDirectory}; `
        + `found ${matches.length}.`
    );
  }

  return resolve(outputDirectory, matches[0]);
}

const outputDirectory = resolve(process.argv[2] ?? "dist-embed");
const entryPath = await resolveEntryPath(
  outputDirectory,
  process.argv[3] ?? "index.js"
);
const maxRawBytes = readPositiveInteger(
  process.argv[4],
  DEFAULT_MAX_RAW_BYTES,
  "Static entry raw-byte budget"
);
const maxGzipBytes = readPositiveInteger(
  process.argv[5],
  DEFAULT_MAX_GZIP_BYTES,
  "Static entry gzip-byte budget"
);
const files = await collectStaticEntryGraph(entryPath, outputDirectory);
const sizes = [...files.entries()].map(([path, bytes]) => ({
  gzip: gzipSync(bytes).byteLength,
  path: relative(outputDirectory, path).replaceAll("\\", "/"),
  raw: bytes.byteLength
})).sort((left, right) => left.path.localeCompare(right.path));
const rawBytes = sizes.reduce((total, file) => total + file.raw, 0);
const gzipBytes = sizes.reduce((total, file) => total + file.gzip, 0);

if (rawBytes > maxRawBytes || gzipBytes > maxGzipBytes) {
  const details = sizes
    .map((file) => `${file.path}: ${file.raw} raw, ${file.gzip} gzip`)
    .join("\n");

  throw new Error(
    `Static entry graph budget exceeded: ${rawBytes} raw / ${gzipBytes} gzip `
      + `(limits ${maxRawBytes} raw / ${maxGzipBytes} gzip).\n${details}`
  );
}

console.log(
  `Static entry graph budget passed: ${rawBytes} raw / ${gzipBytes} gzip across `
    + `${sizes.length} files (limits ${maxRawBytes} raw / ${maxGzipBytes} gzip).`
);
