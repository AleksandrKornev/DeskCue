import {
  lstat,
  open,
  opendir,
  realpath,
  stat
} from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import type {
  WorkspaceDirectoryQuery,
  WorkspaceDirectoryResponse,
  WorkspaceFileEntry,
  WorkspaceFileEntryKind,
  WorkspaceFileQuery,
  WorkspaceFileResponse,
  WorkspaceSummary
} from "@deskcue/protocol";
import { AppError } from "#application/errors";

const MAX_WORKSPACE_FILE_CONTENT_BYTES = 256 * 1024;
const MAX_WORKSPACE_DIRECTORY_SCAN_ENTRIES = 20_000;
const BINARY_SAMPLE_BYTES = 8 * 1024;

type WorkspaceCatalog = {
  listWorkspaces: () => WorkspaceSummary[];
};

type ResolvedWorkspacePath = {
  absolutePath: string;
  relativePath: string;
  workspace: WorkspaceSummary;
};

function compareEntryNames(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodeDirectoryCursor(name: string) {
  return `n_${Buffer.from(name, "utf8").toString("base64url")}`;
}

function decodeDirectoryCursor(cursor: string) {
  if (!cursor.startsWith("n_")) {
    throw new AppError("invalid_input", "Workspace directory cursor is invalid.");
  }
  try {
    const bytes = Buffer.from(cursor.slice(2), "base64url");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!name || encodeDirectoryCursor(name) !== cursor) {
      throw new Error("Non-canonical cursor");
    }
    return name;
  } catch {
    throw new AppError("invalid_input", "Workspace directory cursor is invalid.");
  }
}

function normalizeRelativePath(value: string): string {
  if (value.includes("\0") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new AppError("invalid_input", "Workspace path must be relative.");
  }

  const segments = value.replaceAll("\\", "/").split("/");
  if (segments.includes("..")) {
    throw new AppError("forbidden", "Workspace path escapes the registered workspace.");
  }

  return segments.filter((segment) => segment !== "" && segment !== ".").join("/");
}

function isInsideRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function joinRelativePath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

function readEntryKind(entryStats: Awaited<ReturnType<typeof lstat>>): WorkspaceFileEntryKind {
  if (entryStats.isSymbolicLink()) return "symlink";
  if (entryStats.isDirectory()) return "directory";
  if (entryStats.isFile()) return "file";
  return "other";
}

function looksBinary(bytes: Buffer): boolean {
  if (bytes.includes(0)) return true;
  if (bytes.length === 0) return false;

  let controlBytes = 0;
  for (const byte of bytes) {
    if (byte < 7 || (byte > 13 && byte < 32)) controlBytes += 1;
  }
  return controlBytes / bytes.length > 0.1;
}

function decodeText(bytes: Buffer, truncated: boolean): string | null {
  if (looksBinary(bytes.subarray(0, Math.min(bytes.length, BINARY_SAMPLE_BYTES)))) {
    return null;
  }

  const maximumTrim = truncated ? Math.min(3, bytes.length) : 0;
  for (let trim = 0; trim <= maximumTrim; trim += 1) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        trim === 0 ? bytes : bytes.subarray(0, bytes.length - trim)
      );
    } catch {
      // A bounded preview may end in the middle of a UTF-8 code point.
    }
  }

  return null;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function isMissingFileError(error: unknown): boolean {
  return hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR");
}

function isPermissionError(error: unknown): boolean {
  return hasErrorCode(error, "EACCES") || hasErrorCode(error, "EPERM");
}

function mapFilesystemError(error: unknown, notFoundMessage: string): AppError {
  if (isMissingFileError(error)) return new AppError("not_found", notFoundMessage);
  if (isPermissionError(error)) {
    return new AppError("forbidden", "Workspace path cannot be read.");
  }
  return new AppError("invalid_input", "Workspace path could not be read safely.");
}

async function readRealPath(targetPath: string, notFoundMessage: string): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch (error) {
    throw mapFilesystemError(error, notFoundMessage);
  }
}

async function readLinkStats(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    throw mapFilesystemError(error, "Workspace path not found.");
  }
}

async function readStats(targetPath: string) {
  try {
    return await stat(targetPath);
  } catch (error) {
    throw mapFilesystemError(error, "Workspace path not found.");
  }
}

async function openDirectory(targetPath: string) {
  try {
    return await opendir(targetPath);
  } catch (error) {
    throw mapFilesystemError(error, "Workspace directory not found.");
  }
}

async function openFile(targetPath: string) {
  try {
    return await open(targetPath, "r");
  } catch (error) {
    throw mapFilesystemError(error, "Workspace file not found.");
  }
}

export class WorkspaceFileService {
  constructor(private readonly workspaces: WorkspaceCatalog) {}

  async listDirectory(
    workspaceId: string,
    query: WorkspaceDirectoryQuery
  ): Promise<WorkspaceDirectoryResponse> {
    const resolved = await this.resolveWorkspacePath(workspaceId, query.path);
    const directoryStats = await readStats(resolved.absolutePath);
    if (!directoryStats.isDirectory()) {
      throw new AppError("invalid_input", "Workspace path is not a directory.");
    }

    const directory = await openDirectory(resolved.absolutePath);
    const names: string[] = [];

    for await (const entry of directory) {
      names.push(entry.name);
      if (names.length > MAX_WORKSPACE_DIRECTORY_SCAN_ENTRIES) {
        throw new AppError(
          "invalid_input",
          `Workspace directories are limited to ${MAX_WORKSPACE_DIRECTORY_SCAN_ENTRIES.toLocaleString("en-US")} entries.`
        );
      }
    }

    names.sort(compareEntryNames);
    const afterName = query.cursor ? decodeDirectoryCursor(query.cursor) : null;
    const page = names
      .filter((name) => afterName === null || compareEntryNames(name, afterName) > 0)
      .slice(0, query.limit + 1);
    const hasMore = page.length > query.limit;
    const entries = await Promise.all(
      page.slice(0, query.limit).map((name) => this.describeEntry(resolved, name))
    );

    return {
      entries,
      hasMore,
      nextCursor: hasMore && entries.length > 0
        ? encodeDirectoryCursor(entries[entries.length - 1].name)
        : null,
      path: resolved.relativePath,
      workspaceId: resolved.workspace.id
    };
  }

  async readFile(
    workspaceId: string,
    query: WorkspaceFileQuery
  ): Promise<WorkspaceFileResponse> {
    const resolved = await this.resolveWorkspacePath(workspaceId, query.path);
    const fileStats = await readStats(resolved.absolutePath);
    if (!fileStats.isFile()) {
      throw new AppError("invalid_input", "Workspace path is not a file.");
    }

    const bytesToRead = Math.min(fileStats.size, MAX_WORKSPACE_FILE_CONTENT_BYTES);
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const handle = await openFile(resolved.absolutePath);
    let bytesRead = 0;
    try {
      ({ bytesRead } = await handle.read(buffer, 0, bytesToRead, 0));
    } finally {
      await handle.close();
    }

    const bytes = buffer.subarray(0, bytesRead);
    const truncated = fileStats.size > bytesRead;
    const content = decodeText(bytes, truncated);

    return {
      binary: content === null,
      content,
      modifiedAt: fileStats.mtime.toISOString(),
      path: resolved.relativePath,
      sizeBytes: fileStats.size,
      truncated,
      workspaceId: resolved.workspace.id
    };
  }

  private async describeEntry(
    parent: ResolvedWorkspacePath,
    entryName: string
  ): Promise<WorkspaceFileEntry> {
    const entryPath = path.join(parent.absolutePath, entryName);
    const relativePath = joinRelativePath(parent.relativePath, entryName);

    try {
      const entryStats = await lstat(entryPath);
      const kind = readEntryKind(entryStats);
      return {
        kind,
        modifiedAt: entryStats.mtime.toISOString(),
        name: entryName,
        path: relativePath,
        readable: kind === "directory" || kind === "file",
        sizeBytes: entryStats.isFile() ? entryStats.size : null
      };
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      return {
        kind: "other",
        modifiedAt: null,
        name: entryName,
        path: relativePath,
        readable: false,
        sizeBytes: null
      };
    }
  }

  private async resolveWorkspacePath(
    workspaceId: string,
    requestedPath: string
  ): Promise<ResolvedWorkspacePath> {
    const workspace = this.workspaces
      .listWorkspaces()
      .find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      throw new AppError("not_found", "Workspace not found.");
    }

    const relativePath = normalizeRelativePath(requestedPath);
    const rootPath = await readRealPath(workspace.path, "Workspace not found.");
    const segments = relativePath ? relativePath.split("/") : [];
    let absolutePath = rootPath;

    for (const segment of segments) {
      absolutePath = path.join(absolutePath, segment);
      const entryStats = await readLinkStats(absolutePath);
      if (entryStats.isSymbolicLink()) {
        throw new AppError("forbidden", "Symbolic links cannot be opened from workspace files.");
      }
    }

    const canonicalPath = await readRealPath(absolutePath, "Workspace path not found.");
    if (!isInsideRoot(canonicalPath, rootPath)) {
      throw new AppError("forbidden", "Workspace path escapes the registered workspace.");
    }

    return {
      absolutePath: canonicalPath,
      relativePath,
      workspace
    };
  }
}
