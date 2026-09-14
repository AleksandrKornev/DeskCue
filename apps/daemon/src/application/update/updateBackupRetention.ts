import { readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

function listUpdateBackupPaths(databaseFilePath: string) {
  const directory = path.dirname(databaseFilePath);
  const prefix = `${path.basename(databaseFilePath)}.backup-update-`;

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
    .map((entry) => path.join(directory, entry.name));
}

export function retainCurrentUpdateBackup(
  databaseFilePath: string,
  currentBackupPath: string
) {
  try {
    for (const backupPath of listUpdateBackupPaths(databaseFilePath)) {
      if (backupPath !== currentBackupPath) rmSync(backupPath, { force: true });
    }
  } catch (error) {
    try {
      rmSync(currentBackupPath, { force: true });
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Pre-update backup retention failed and the new backup could not be rolled back."
      );
    }

    throw error;
  }
}

export function pruneUpdateBackupsBeforeCreate(databaseFilePath: string) {
  const backups = listUpdateBackupPaths(databaseFilePath)
    .map((backupPath) => ({ backupPath, modifiedAt: statSync(backupPath).mtimeMs }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const { backupPath } of backups.slice(1)) {
    rmSync(backupPath, { force: true });
  }
}
