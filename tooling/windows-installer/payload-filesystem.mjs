import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const FORBIDDEN_PATH_SEGMENTS = new Set([
  ".deskcue-data",
  ".git",
  ".pnpm",
  "coverage",
  "dist-embed",
  "test-results"
]);
const FORBIDDEN_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".npmrc",
  ".pnpmfile.cjs",
  ".yarnrc",
  ".yarnrc.yml"
]);

function canonicalPath(filePath) {
  return realpathSync.native?.(filePath) ?? realpathSync(filePath);
}

function assertExistingPathChainIsSafe(repositoryRoot, directoryPath) {
  const canonicalRepositoryRoot = canonicalPath(repositoryRoot);
  const relativeDirectoryPath = relative(repositoryRoot, directoryPath);
  let currentPath = repositoryRoot;
  let expectedCanonicalPath = canonicalRepositoryRoot;

  if (!lstatSync(repositoryRoot).isDirectory() || lstatSync(repositoryRoot).isSymbolicLink()) {
    throw new Error(`Repository root must be a real directory, not a reparse link: ${repositoryRoot}`);
  }

  for (const segment of relativeDirectoryPath.split(sep).filter(Boolean)) {
    currentPath = join(currentPath, segment);
    expectedCanonicalPath = join(expectedCanonicalPath, segment);
    if (!existsSync(currentPath)) break;

    const currentStats = lstatSync(currentPath);
    if (currentStats.isSymbolicLink()) {
      throw new Error(`Refusing to traverse a symbolic link or junction: ${currentPath}`);
    }

    const canonicalCurrentPath = canonicalPath(currentPath);
    if (!isWithin(canonicalRepositoryRoot, canonicalCurrentPath)) {
      throw new Error(`Refusing to traverse a reparse path outside the repository: ${currentPath}`);
    }
    if (relative(expectedCanonicalPath, canonicalCurrentPath) !== "") {
      throw new Error(`Refusing to traverse a reparse path: ${currentPath}`);
    }
  }
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function normalizeRelativePath(filePath) {
  return filePath.split(sep).join("/");
}

export function isWithin(parentPath, candidatePath) {
  const candidateRelativePath = relative(resolve(parentPath), resolve(candidatePath));

  return candidateRelativePath === "" || (
    !candidateRelativePath.startsWith(`..${sep}`) &&
    candidateRelativePath !== ".." &&
    !isAbsolute(candidateRelativePath)
  );
}

export function assertSafeReplaceDirectory(directoryPath, repositoryRoot) {
  const resolvedDirectoryPath = resolve(directoryPath);
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const directoryName = basename(resolvedDirectoryPath).toLowerCase();

  if (
    !isWithin(resolvedRepositoryRoot, resolvedDirectoryPath) ||
    resolvedDirectoryPath === resolvedRepositoryRoot ||
    dirname(resolvedDirectoryPath) === resolvedDirectoryPath ||
    !directoryName.includes("payload") ||
    directoryName === "" ||
    directoryName === "." ||
    directoryName === ".."
  ) {
    throw new Error(`Refusing to replace unsafe payload directory: ${resolvedDirectoryPath}`);
  }

  if (!existsSync(resolvedRepositoryRoot)) {
    throw new Error(`Repository root does not exist: ${resolvedRepositoryRoot}`);
  }

  assertExistingPathChainIsSafe(resolvedRepositoryRoot, resolvedDirectoryPath);

  return resolvedDirectoryPath;
}

export function removeSafePayloadDirectory(directoryPath, repositoryRoot) {
  const resolvedDirectoryPath = assertSafeReplaceDirectory(directoryPath, repositoryRoot);
  if (!existsSync(resolvedDirectoryPath)) return;

  const deletionPath = `${resolvedDirectoryPath}.delete-${process.pid}-${randomUUID()}`;
  assertSafeReplaceDirectory(deletionPath, repositoryRoot);
  renameSync(resolvedDirectoryPath, deletionPath);

  const deletionStats = lstatSync(deletionPath);
  if (!deletionStats.isDirectory() || deletionStats.isSymbolicLink()) {
    throw new Error(`Refusing to recursively remove a reparse path: ${deletionPath}`);
  }
  assertExistingPathChainIsSafe(resolve(repositoryRoot), deletionPath);
  rmSync(deletionPath, { recursive: true });
}

export function resetSafePayloadDirectory(directoryPath, repositoryRoot) {
  const resolvedDirectoryPath = assertSafeReplaceDirectory(directoryPath, repositoryRoot);

  removeSafePayloadDirectory(resolvedDirectoryPath, repositoryRoot);
  mkdirSync(resolvedDirectoryPath, { recursive: true });
}

export function shouldCopyPayloadPath(sourcePath) {
  const normalizedPath = sourcePath.replaceAll("\\", "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  const fileName = segments.at(-1)?.toLowerCase() ?? "";

  if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment.toLowerCase()))) return false;
  if (FORBIDDEN_FILE_NAMES.has(fileName) || fileName.startsWith(".env.")) return false;
  if (/\.(?:db|key|log|p12|pem|pfx|sqlite|sqlite3)(?:[.-]|$)/i.test(fileName)) return false;
  if (/(?:credential|secret|token).*\.json$/i.test(fileName)) return false;

  return true;
}

export function copyPayloadTree(sourcePath, destinationPath) {
  if (!existsSync(sourcePath)) throw new Error(`Required payload input is missing: ${sourcePath}`);

  const sourceStats = lstatSync(sourcePath);
  if (sourceStats.isSymbolicLink()) {
    throw new Error(`Payload inputs must not contain symbolic links or junctions: ${sourcePath}`);
  }
  if (sourceStats.isFile()) {
    mkdirSync(dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
    return;
  }
  if (!sourceStats.isDirectory()) throw new Error(`Unsupported payload input type: ${sourcePath}`);

  mkdirSync(destinationPath, { recursive: true });
  for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
    const entrySourcePath = join(sourcePath, entry.name);
    const entryDestinationPath = join(destinationPath, entry.name);
    const entryStats = lstatSync(entrySourcePath);

    if (entryStats.isSymbolicLink()) {
      throw new Error(`Payload inputs must not contain symbolic links or junctions: ${entrySourcePath}`);
    }
    if (!shouldCopyPayloadPath(entrySourcePath)) continue;

    copyPayloadTree(entrySourcePath, entryDestinationPath);
  }
}
