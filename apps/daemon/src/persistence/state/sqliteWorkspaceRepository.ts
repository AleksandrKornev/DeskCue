import type Database from "better-sqlite3";

import type { WorkspaceSummary } from "@deskcue/protocol";

import type { WorkspaceRow } from "./sqliteStateRows.ts";

function deleteMissingRows(
  database: Database.Database,
  tableName: "workspaces",
  ids: string[]
) {
  if (ids.length === 0) {
    database.prepare(`DELETE FROM ${tableName}`).run();
    return;
  }
  const placeholders = ids.map(() => "?").join(", ");
  database.prepare(`DELETE FROM ${tableName} WHERE id NOT IN (${placeholders})`).run(...ids);
}

function pruneMissingCachedRows(cache: Map<string, string>, ids: string[]) {
  const nextIds = new Set(ids);
  for (const id of cache.keys()) {
    if (!nextIds.has(id)) {
      cache.delete(id);
    }
  }
}

export class SqliteWorkspaceRepository {
  private readonly persistedJsonById = new Map<string, string>();

  constructor(private readonly database: Database.Database) {}

  loadRows() {
    return this.database
      .prepare("SELECT id, json FROM workspaces ORDER BY created_at ASC")
      .all() as WorkspaceRow[];
  }

  rememberRows(rows: WorkspaceRow[]) {
    this.persistedJsonById.clear();
    for (const row of rows) {
      this.persistedJsonById.set(row.id, row.json);
    }
  }

  deleteMissing(ids: string[]) {
    deleteMissingRows(this.database, "workspaces", ids);
  }

  upsertChanged(workspaces: WorkspaceSummary[], updatedAt: string) {
    const statement = this.database.prepare(`
      INSERT INTO workspaces (id, name, path, created_at, json, updated_at)
      VALUES (@id, @name, @path, @createdAt, @json, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        path = excluded.path,
        json = excluded.json,
        updated_at = excluded.updated_at
    `);
    const persistedRows: WorkspaceRow[] = [];
    let skipped = 0;
    for (const workspace of workspaces) {
      const json = JSON.stringify(workspace);
      if (this.persistedJsonById.get(workspace.id) === json) {
        skipped += 1;
        continue;
      }
      statement.run({
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        createdAt: workspace.createdAt,
        json,
        updatedAt
      });
      persistedRows.push({ id: workspace.id, json });
    }
    return { persistedRows, skipped };
  }

  commitSave(workspaces: WorkspaceSummary[], persistedRows: WorkspaceRow[], pruneMissing: boolean) {
    if (pruneMissing) {
      pruneMissingCachedRows(this.persistedJsonById, workspaces.map((workspace) => workspace.id));
    }
    for (const row of persistedRows) {
      this.persistedJsonById.set(row.id, row.json);
    }
  }
}
