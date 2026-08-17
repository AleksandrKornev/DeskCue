import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const requestedFilters = process.argv.slice(2).map(normalizePath);
const discoveredFiles = await collectNodeTestFiles("src");
const testFiles = requestedFilters.length === 0
  ? discoveredFiles
  : discoveredFiles.filter((testFile) => requestedFilters.some((filter) => matchesFilter(testFile, filter)));

if (testFiles.length === 0) {
  const suffix = requestedFilters.length > 0
    ? ` matching: ${requestedFilters.join(", ")}`
    : "";
  console.error(`No web Node test files found${suffix}. Vitest files (*.unit.test.*) belong to npm run test:unit.`);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  {
    stdio: "inherit"
  }
);

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Web Node tests terminated by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

async function collectNodeTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectNodeTestFiles(path));
      continue;
    }

    if (
      entry.isFile()
      && entry.name.endsWith(".test.ts")
      && !entry.name.endsWith(".unit.test.ts")
    ) {
      files.push(normalizePath(relative(process.cwd(), path)));
    }
  }

  return files.sort();
}

function matchesFilter(testFile, filter) {
  return testFile === filter
    || testFile.endsWith(`/${filter}`)
    || basename(testFile) === filter;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
