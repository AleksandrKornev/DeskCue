import { initialWorkspaceSessionsMigration } from "./0001_initialWorkspaceSessions.ts";

export const DESKCUE_SQLITE_SCHEMA_VERSION = 1;

export const SQLITE_MIGRATIONS = [initialWorkspaceSessionsMigration];
