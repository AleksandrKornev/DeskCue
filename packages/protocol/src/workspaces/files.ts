import { ProtocolSchemaError } from "../schema.ts";

export const DEFAULT_WORKSPACE_DIRECTORY_LIMIT = 50;
export const MAX_WORKSPACE_DIRECTORY_LIMIT = 100;

export type WorkspaceFileEntryKind = "directory" | "file" | "other" | "symlink";

export interface WorkspaceDirectoryQuery {
  cursor: string | null;
  limit: number;
  path: string;
}

export interface WorkspaceFileQuery {
  path: string;
}

export interface WorkspaceFileEntry {
  kind: WorkspaceFileEntryKind;
  modifiedAt: string | null;
  name: string;
  path: string;
  readable: boolean;
  sizeBytes: number | null;
}

export interface WorkspaceDirectoryResponse {
  entries: WorkspaceFileEntry[];
  hasMore: boolean;
  nextCursor: string | null;
  path: string;
  workspaceId: string;
}

export interface WorkspaceFileResponse {
  binary: boolean;
  content: string | null;
  modifiedAt: string;
  path: string;
  sizeBytes: number;
  truncated: boolean;
  workspaceId: string;
}

export function parseWorkspaceDirectoryQuery(value: unknown): WorkspaceDirectoryQuery {
  const query = readQueryObject(value);

  return {
    cursor: readCursor(query.cursor),
    limit: readDirectoryLimit(query.limit),
    path: readRelativePath(query.path, true)
  };
}

export function parseWorkspaceFileQuery(value: unknown): WorkspaceFileQuery {
  const query = readQueryObject(value);

  return {
    path: readRelativePath(query.path, false)
  };
}

function readQueryObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolSchemaError("Request query must be an object.");
  }

  return value as Record<string, unknown>;
}

function readRelativePath(value: unknown, optional: boolean): string {
  if (value === undefined && optional) {
    return "";
  }
  if (typeof value !== "string" || (!optional && value.length === 0)) {
    throw new ProtocolSchemaError("Query path must be a string.");
  }
  if (value.length > 4_096) {
    throw new ProtocolSchemaError("Query path exceeds the 4,096-character limit.");
  }

  return value;
}

function readCursor(value: unknown): string | null {
  if (value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^n_[A-Za-z0-9_-]{1,1366}$/.test(value)) {
    throw new ProtocolSchemaError("Query cursor is invalid.");
  }
  return value;
}

function readDirectoryLimit(value: unknown): number {
  if (value === undefined || value === "") {
    return DEFAULT_WORKSPACE_DIRECTORY_LIMIT;
  }
  if (typeof value !== "string" || !/^\d{1,3}$/.test(value)) {
    throw new ProtocolSchemaError("Query limit must be a positive integer.");
  }

  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_WORKSPACE_DIRECTORY_LIMIT) {
    throw new ProtocolSchemaError(
      `Query limit must be between 1 and ${MAX_WORKSPACE_DIRECTORY_LIMIT}.`
    );
  }

  return limit;
}
