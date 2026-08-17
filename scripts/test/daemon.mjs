import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const requestedFilters = process.argv.slice(2).map(normalizePath);
const discoveredTestFiles = await collectTestFiles("src");
const testFiles = requestedFilters.length === 0
  ? discoveredTestFiles
  : discoveredTestFiles.filter((testFile) =>
      requestedFilters.some((filter) => matchesFilter(testFile, filter))
    );

if (testFiles.length === 0) {
  const suffix = requestedFilters.length > 0
    ? ` matching: ${requestedFilters.join(", ")}`
    : "";
  console.error(`No daemon test files found${suffix}.`);
  process.exit(1);
}

const testDataDir = mkdtempSync(join(tmpdir(), "deskcue-daemon-tests-"));
let cleanedUp = false;
let isShuttingDown = false;
let activeChild = null;

const TEST_FILE_TIMEOUT_MS = 120_000;

function cleanupTestDataDir() {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;
  try {
    rmSync(testDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to remove daemon test data directory: ${message}`);
  }
}

process.once("SIGINT", () => {
  stopChildAndExit("SIGINT");
});

process.once("SIGTERM", () => {
  stopChildAndExit("SIGTERM");
});

for (const [testIndex, testFile] of testFiles.entries()) {
  const code = await runTestFile(testFile, testIndex);
  if (code !== 0) {
    cleanupTestDataDir();
    process.exit(code);
  }
}

cleanupTestDataDir();

function stopChildAndExit(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  if (!activeChild) {
    cleanupTestDataDir();
    process.exit(1);
  }

  activeChild.once("exit", () => {
    cleanupTestDataDir();
    process.exit(1);
  });
  activeChild.kill(signal);

  const forceKillTimer = setTimeout(() => {
    activeChild?.kill("SIGKILL");
    cleanupTestDataDir();
    process.exit(1);
  }, 5000);
  forceKillTimer.unref();
}

function runTestFile(testFile, testIndex) {
  return new Promise((resolve) => {
    const testFileDataDir = join(testDataDir, String(testIndex));
    const child = spawn(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "--test",
        "--test-timeout=30000",
        testFile
      ],
      {
        env: {
          ...process.env,
          DESKCUE_DATA_DIR: testFileDataDir,
          DESKCUE_DATABASE_FILE: join(testFileDataDir, "service", "deskcue.sqlite"),
          DESKCUE_STATE_FILE: join(testFileDataDir, "service", "state.json")
        },
        stdio: "inherit"
      }
    );
    activeChild = child;
    let completed = false;

    const timeout = setTimeout(() => {
      if (completed) {
        return;
      }

      completed = true;
      console.error(`Daemon test file timed out after ${TEST_FILE_TIMEOUT_MS}ms: ${testFile}`);
      child.kill("SIGKILL");

      const forcedExitFallback = setTimeout(() => {
        activeChild = null;
        resolve(1);
      }, 5000);
      forcedExitFallback.unref();

      child.once("exit", () => {
        clearTimeout(forcedExitFallback);
        activeChild = null;
        resolve(1);
      });
    }, TEST_FILE_TIMEOUT_MS);

    child.on("exit", (code, signal) => {
      if (completed) {
        return;
      }

      completed = true;
      clearTimeout(timeout);
      activeChild = null;

      if (signal) {
        console.error(`Daemon test file terminated by ${signal}: ${testFile}`);
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });

    child.on("error", (error) => {
      if (completed) {
        return;
      }

      completed = true;
      clearTimeout(timeout);
      activeChild = null;
      console.error(error);
      resolve(1);
    });
  });
}

async function collectTestFiles(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true
  });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(path));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(relative(process.cwd(), path).replaceAll("\\", "/"));
    }
  }

  return files.sort();
}

function matchesFilter(testFile, filter) {
  const testFileName = testFile.slice(testFile.lastIndexOf("/") + 1);
  return testFile === filter
    || testFile.endsWith(`/${filter}`)
    || testFileName === filter;
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
