import { DESKCUE_SQLITE_SCHEMA_VERSION } from "./index.ts";
import type { SqliteMigration } from "./types.ts";

export function assertMigrationListIsValid(
  migrations: SqliteMigration[],
  schemaVersion = DESKCUE_SQLITE_SCHEMA_VERSION
) {
  const versions = migrations.map((migration) => migration.version);
  const uniqueVersions = new Set(versions);
  if (uniqueVersions.size !== versions.length) {
    throw new Error("DeskCue SQLite migrations must have unique versions.");
  }

  const sortedVersions = [...versions].sort((left, right) => left - right);
  for (let index = 0; index < sortedVersions.length; index += 1) {
    const expectedVersion = index + 1;
    if (sortedVersions[index] !== expectedVersion) {
      throw new Error("DeskCue SQLite migrations must be contiguous from version 1.");
    }
  }

  const latestVersion = sortedVersions.at(-1) ?? 0;
  if (latestVersion !== schemaVersion) {
    throw new Error("DeskCue SQLite schema version must match the latest migration.");
  }
}

export function assertSupportedSchemaVersion(
  version: number,
  schemaVersion = DESKCUE_SQLITE_SCHEMA_VERSION
) {
  if (version > schemaVersion) {
    throw new Error(
      `Unsupported DeskCue SQLite schema version ${version}. ` +
        `This daemon supports version ${schemaVersion}.`
    );
  }
}
