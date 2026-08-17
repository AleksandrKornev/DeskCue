import type Database from "better-sqlite3";

export type SqliteMigration = {
  apply: (database: Database.Database) => void;
  checksum: string;
  compatibleChecksums?: string[];
  name: string;
  version: number;
};
