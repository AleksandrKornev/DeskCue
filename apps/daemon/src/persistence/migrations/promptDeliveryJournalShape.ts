import type Database from "better-sqlite3";

type SqliteColumnShape = {
  name: string;
  notnull: 0 | 1;
  pk: 0 | 1;
  type: string;
};

const LEGACY_PROMPT_DELIVERY_COLUMNS: SqliteColumnShape[] = [
  { name: "id", notnull: 0, pk: 1, type: "TEXT" },
  { name: "session_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "adapter_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "source_session_id", notnull: 0, pk: 0, type: "TEXT" },
  { name: "prompt_text", notnull: 1, pk: 0, type: "TEXT" },
  { name: "phase", notnull: 1, pk: 0, type: "TEXT" },
  { name: "requested_at", notnull: 1, pk: 0, type: "TEXT" },
  { name: "transport_started_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "completed_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "updated_at", notnull: 1, pk: 0, type: "TEXT" }
];

const CURRENT_PROMPT_DELIVERY_COLUMNS: SqliteColumnShape[] = [
  { name: "id", notnull: 0, pk: 1, type: "TEXT" },
  { name: "session_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "adapter_id", notnull: 1, pk: 0, type: "TEXT" },
  { name: "source_session_id", notnull: 0, pk: 0, type: "TEXT" },
  { name: "prompt_text", notnull: 1, pk: 0, type: "TEXT" },
  { name: "phase", notnull: 1, pk: 0, type: "TEXT" },
  { name: "requested_at", notnull: 1, pk: 0, type: "TEXT" },
  { name: "dispatching_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "accepted_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "completed_at", notnull: 0, pk: 0, type: "TEXT" },
  { name: "updated_at", notnull: 1, pk: 0, type: "TEXT" }
];

function hasExactPromptDeliveryShape(database: Database.Database, expected: readonly SqliteColumnShape[]) {
  const columns = database.prepare("PRAGMA table_info(prompt_delivery_journal)").all() as SqliteColumnShape[];

  return columns.length === expected.length && columns.every((column, index) => {
    const expectedColumn = expected[index];

    return Boolean(
      expectedColumn &&
      column.name === expectedColumn.name &&
      column.notnull === expectedColumn.notnull &&
      column.pk === expectedColumn.pk &&
      column.type.toUpperCase() === expectedColumn.type
    );
  });
}

export function hasExactLegacyPromptDeliveryShape(database: Database.Database) {
  return hasExactPromptDeliveryShape(database, LEGACY_PROMPT_DELIVERY_COLUMNS);
}

export function hasExactCurrentPromptDeliveryShape(database: Database.Database) {
  return hasExactPromptDeliveryShape(database, CURRENT_PROMPT_DELIVERY_COLUMNS);
}
