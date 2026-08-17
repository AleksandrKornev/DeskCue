import {
  open,
  opendir,
  realpath,
  stat
} from "node:fs/promises";
import path from "node:path";

import { clampLocalLlmToolLimit, LocalLlmToolError } from "./localLlmToolTypes.ts";
import type { LocalLlmToolExecutorLimits, LocalLlmToolRequest } from "./localLlmToolTypes.ts";

type ListWorkspaceFilesRequest = Extract<LocalLlmToolRequest, { name: "list_workspace_files" }>;
type ReadWorkspaceFileRequest = Extract<LocalLlmToolRequest, { name: "read_workspace_file" }>;
type SearchWorkspaceTextRequest = Extract<LocalLlmToolRequest, { name: "search_workspace_text" }>;

type WorkspaceSearchBudget = {
  bytes: number;
  deadline: number;
  directories: number;
  files: number;
  truncated: boolean;
};

function normalizeWorkspacePath(value: string) {
  const normalized = path.resolve(value);
  if (process.platform !== "win32") {
    return normalized;
  }
  if (normalized.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${normalized.slice("\\\\?\\UNC\\".length)}`.toLowerCase();
  }
  if (normalized.startsWith("\\\\?\\")) {
    return normalized.slice(4).toLowerCase();
  }
  return normalized.toLowerCase();
}

export async function resolveLocalLlmWorkspaceRoot(workspacePath: string) {
  const resolved = await realpath(workspacePath);
  if (!(await stat(resolved)).isDirectory()) {
    throw new LocalLlmToolError("Attached workspace is not a directory.");
  }
  return resolved;
}

export function assertInsideLocalLlmWorkspace(root: string, candidate: string) {
  const normalizedRoot = normalizeWorkspacePath(root).replace(/[\\\/]+$/, "");
  const normalizedCandidate = normalizeWorkspacePath(candidate);
  const normalizedSeparator = path.sep;
  const isInside = normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${normalizedSeparator}`);

  if (isInside) return;
  throw new LocalLlmToolError("Path escapes the attached workspace.");
}

export function resolveLocalLlmWorkspacePath(root: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new LocalLlmToolError("Path must be relative to the attached workspace.");
  }
  const candidate = path.resolve(root, relativePath);
  assertInsideLocalLlmWorkspace(root, candidate);
  return candidate;
}

export async function resolveLocalLlmExistingPath(root: string, relativePath: string) {
  const candidate = resolveLocalLlmWorkspacePath(root, relativePath);
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch {
    throw new LocalLlmToolError("Requested path does not exist.");
  }
  const canonicalRoot = await realpath(root).catch(() => root);
  assertInsideLocalLlmWorkspace(canonicalRoot, resolved);
  return resolved;
}

export function toLocalLlmWorkspaceRelative(root: string, value: string) {
  return path.relative(root, value).replaceAll("\\", "/") || ".";
}

function isIgnoredLocalLlmWorkspaceEntry(name: string) {
  return name === ".git" || name === "node_modules" || name === ".deskcue-data";
}

export async function listLocalLlmWorkspaceFiles(
  root: string,
  request: ListWorkspaceFilesRequest,
  limits: LocalLlmToolExecutorLimits,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const directory = await resolveLocalLlmExistingPath(root, request.path ?? ".");
  if (!(await stat(directory)).isDirectory()) {
    throw new LocalLlmToolError("The requested path is not a directory.");
  }
  const maxEntries = clampLocalLlmToolLimit(request.maxEntries ?? 100, 1, limits.maxWorkspaceEntries);
  const entries: Array<{ name: string; type: "directory" | "file" | "other" }> = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    signal?.throwIfAborted();
    if (isIgnoredLocalLlmWorkspaceEntry(entry.name)) continue;
    entries.push({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
    });
    if (entries.length > maxEntries) break;
  }
  const truncated = entries.length > maxEntries;
  return {
    entries: entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, maxEntries)
      .map((entry) => ({
        path: toLocalLlmWorkspaceRelative(root, path.join(directory, entry.name)),
        type: entry.type
      })),
    truncated
  };
}

async function readBoundedLocalLlmFile(filePath: string, maxBytes: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    signal?.throwIfAborted();
    return {
      buffer: buffer.subarray(0, Math.min(bytesRead, maxBytes)),
      truncated: bytesRead > maxBytes
    };
  } finally {
    await handle.close();
  }
}

export async function readLocalLlmWorkspaceFile(
  root: string,
  request: ReadWorkspaceFileRequest,
  limits: LocalLlmToolExecutorLimits,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const filePath = await resolveLocalLlmExistingPath(root, request.path);
  if (!(await stat(filePath)).isFile()) {
    throw new LocalLlmToolError("The requested path is not a file.");
  }
  const maxBytes = clampLocalLlmToolLimit(request.maxBytes ?? limits.maxReadBytes, 1, limits.maxReadBytes);
  const bounded = await readBoundedLocalLlmFile(filePath, maxBytes, signal);
  if (bounded.buffer.includes(0)) {
    throw new LocalLlmToolError("Binary files cannot be read by this tool.");
  }
  return {
    content: bounded.buffer.subarray(0, maxBytes).toString("utf8"),
    path: toLocalLlmWorkspaceRelative(root, filePath),
    truncated: bounded.truncated
  };
}

function positiveInteger(value: number) {
  return Math.max(1, Math.floor(value));
}

function isSearchBudgetExhausted(
  budget: WorkspaceSearchBudget,
  limits: LocalLlmToolExecutorLimits
) {
  const exhausted = budget.files >= positiveInteger(limits.maxSearchFiles)
    || budget.bytes >= positiveInteger(limits.maxSearchBytes)
    || Date.now() >= budget.deadline;
  budget.truncated ||= exhausted;
  return exhausted;
}

async function walkLocalLlmWorkspaceFiles(
  root: string,
  start: string,
  visit: (filePath: string) => Promise<boolean>,
  budget: WorkspaceSearchBudget,
  limits: LocalLlmToolExecutorLimits,
  signal?: AbortSignal
) {
  const queue: Array<{ depth: number; directory: string }> = [{ depth: 0, directory: start }];
  while (queue.length > 0) {
    signal?.throwIfAborted();
    if (isSearchBudgetExhausted(budget, limits)) return;
    if (budget.directories >= positiveInteger(limits.maxSearchDirectories)) {
      budget.truncated = true;
      return;
    }
    const current = queue.shift();
    if (!current) return;
    const canonicalDirectory = await realpath(current.directory);
    assertInsideLocalLlmWorkspace(root, canonicalDirectory);
    budget.directories += 1;
    const directory = await opendir(canonicalDirectory);
    for await (const entry of directory) {
      signal?.throwIfAborted();
      if (isSearchBudgetExhausted(budget, limits)) return;
      if (isIgnoredLocalLlmWorkspaceEntry(entry.name) || entry.isSymbolicLink()) continue;
      const entryPath = path.join(canonicalDirectory, entry.name);
      if (entry.isDirectory()) {
        if (current.depth >= positiveInteger(limits.maxSearchDepth)) {
          budget.truncated = true;
        } else {
          queue.push({ depth: current.depth + 1, directory: entryPath });
        }
      } else if (entry.isFile() && !(await visit(entryPath))) {
        return;
      }
    }
  }
}

export async function searchLocalLlmWorkspaceText(
  root: string,
  request: SearchWorkspaceTextRequest,
  limits: LocalLlmToolExecutorLimits,
  signal?: AbortSignal
) {
  if (!request.query.trim() || request.query.length > 256) {
    throw new LocalLlmToolError("Search query must contain 1 to 256 characters.");
  }
  signal?.throwIfAborted();
  const start = await resolveLocalLlmExistingPath(root, request.path ?? ".");
  const maxResults = clampLocalLlmToolLimit(request.maxResults ?? 30, 1, limits.maxSearchResults);
  const matches: Array<{ line: number; path: string; text: string }> = [];
  const budget: WorkspaceSearchBudget = {
    bytes: 0,
    deadline: Date.now() + positiveInteger(limits.maxSearchDurationMs),
    directories: 0,
    files: 0,
    truncated: false
  };

  const visit = async (filePath: string) => {
    signal?.throwIfAborted();
    if (isSearchBudgetExhausted(budget, limits)) return false;
    const canonicalFilePath = await realpath(filePath);
    assertInsideLocalLlmWorkspace(root, canonicalFilePath);
    const fileStat = await stat(canonicalFilePath);
    if (!fileStat.isFile()) return true;
    budget.files += 1;
    const maxFileBytes = positiveInteger(limits.maxSearchFileBytes);
    if (fileStat.size > maxFileBytes) {
      budget.truncated = true;
      return true;
    }
    if (budget.bytes + fileStat.size > positiveInteger(limits.maxSearchBytes)) {
      budget.truncated = true;
      return false;
    }
    const bounded = await readBoundedLocalLlmFile(canonicalFilePath, maxFileBytes, signal);
    budget.bytes += bounded.buffer.byteLength;
    if (bounded.truncated || bounded.buffer.includes(0)) {
      budget.truncated ||= bounded.truncated;
      return true;
    }
    const lines = bounded.buffer.toString("utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
      if (lines[index].includes(request.query)) {
        matches.push({
          line: index + 1,
          path: toLocalLlmWorkspaceRelative(root, canonicalFilePath),
          text: lines[index].slice(0, 500)
        });
      }
    }
    return matches.length < maxResults;
  };

  const startStat = await stat(start);
  if (startStat.isFile()) {
    await visit(start);
  } else if (startStat.isDirectory()) {
    await walkLocalLlmWorkspaceFiles(root, start, visit, budget, limits, signal);
  } else {
    throw new LocalLlmToolError("The requested search path is not a file or directory.");
  }
  return {
    matches,
    truncated: budget.truncated || matches.length >= maxResults
  };
}
