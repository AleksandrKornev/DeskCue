import {
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync
} from "node:fs";
import { join } from "node:path";

const DEFAULT_LOG_MAX_FILES = 1;
const DEFAULT_LOG_MAX_SIZE_MB = 3;

export function readFileSize(filePath: string) {
  return existsSync(filePath) ? statSync(filePath).size : 0;
}

export function readDataDirectoryBytes(directoryPath: string): number {
  if (!existsSync(directoryPath)) {
    return 0;
  }

  return readdirSync(directoryPath, { withFileTypes: true }).reduce((total, entry) => {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return total + readDataDirectoryBytes(entryPath);
    }
    return entry.isFile() ? total + readFileSize(entryPath) : total;
  }, 0);
}

export function readLocalChatLibraryStats(localChatLibraryPath: string) {
  if (!existsSync(localChatLibraryPath)) {
    return {
      path: localChatLibraryPath,
      bytes: 0,
      chatCount: 0
    };
  }

  const entries = readdirSync(localChatLibraryPath, { withFileTypes: true });
  const activeChatCount = entries.filter((entry) =>
    entry.isDirectory() && entry.name !== "archive"
  ).length;
  const archivePath = join(localChatLibraryPath, "archive");
  const archivedChatCount = existsSync(archivePath)
    ? readdirSync(archivePath, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
    : 0;

  return {
    path: localChatLibraryPath,
    bytes: readDataDirectoryBytes(localChatLibraryPath),
    chatCount: activeChatCount + archivedChatCount
  };
}

export function readLogBytes(dataDirectory: string) {
  const logDirectory = join(dataDirectory, "logs");
  if (!existsSync(logDirectory)) {
    return 0;
  }

  return readdirSync(logDirectory)
    .filter((fileName) => fileName.startsWith("daemon.jsonl"))
    .reduce((total, fileName) => total + readFileSize(join(logDirectory, fileName)), 0);
}

export function listMigrationBackupFiles(dataDirectory: string) {
  if (!existsSync(dataDirectory)) {
    return [];
  }

  return readdirSync(dataDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^deskcue\.sqlite\.backup-v/.test(entry.name))
    .map((entry) => join(dataDirectory, entry.name));
}

export function readMigrationBackupStats(dataDirectory: string) {
  const backups = listMigrationBackupFiles(dataDirectory);
  return {
    bytes: backups.reduce((total, backupPath) => total + readFileSize(backupPath), 0),
    count: backups.length
  };
}

export function clearMigrationBackupFiles(dataDirectory: string) {
  const backups = listMigrationBackupFiles(dataDirectory);
  const deletedBytes = backups.reduce((total, backupPath) => total + readFileSize(backupPath), 0);
  for (const backupPath of backups) {
    rmSync(backupPath, { force: true });
  }
  return {
    deletedBackups: backups.length,
    deletedBytes
  };
}

export function clearDaemonLogs(dataDirectory: string) {
  const logDirectory = join(dataDirectory, "logs");
  if (!existsSync(logDirectory)) {
    return { clearedBytes: 0, deletedFiles: 0 };
  }

  let clearedBytes = 0;
  let deletedFiles = 0;
  for (const fileName of readdirSync(logDirectory)) {
    if (!fileName.startsWith("daemon.jsonl")) {
      continue;
    }
    const filePath = join(logDirectory, fileName);
    clearedBytes += readFileSize(filePath);
    if (fileName === "daemon.jsonl") {
      truncateSync(filePath, 0);
    } else {
      rmSync(filePath, { force: true });
      deletedFiles += 1;
    }
  }
  return { clearedBytes, deletedFiles };
}

export function readPositiveIntegerEnv(name: string, defaultValue: number) {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }
  const parsed = Number(rawValue);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function listRotatedDaemonLogFiles(logDirectory: string) {
  return readdirSync(logDirectory)
    .map((fileName) => ({
      fileName,
      suffix: Number(fileName.slice("daemon.jsonl.".length))
    }))
    .filter(
      (entry) =>
        entry.fileName.startsWith("daemon.jsonl.") &&
        Number.isInteger(entry.suffix) &&
        entry.suffix > 0
    )
    .sort((left, right) => right.suffix - left.suffix)
    .map((entry) => entry.fileName);
}

function rotateCurrentLogFile(logFilePath: string, maxFiles: number) {
  if (maxFiles <= 0) {
    rmSync(logFilePath, { force: true });
    return;
  }
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = `${logFilePath}.${index}`;
    const target = `${logFilePath}.${index + 1}`;
    if (existsSync(source)) {
      renameSync(source, target);
    }
  }
  if (existsSync(`${logFilePath}.${maxFiles}`)) {
    rmSync(`${logFilePath}.${maxFiles}`, { force: true });
  }
  renameSync(logFilePath, `${logFilePath}.1`);
}

export function pruneDaemonLogFiles(dataDirectory: string, storageMaxBytes: number) {
  const logDirectory = join(dataDirectory, "logs");
  if (!existsSync(logDirectory)) {
    return 0;
  }

  const logFilePath = join(logDirectory, "daemon.jsonl");
  const maxFiles = readPositiveIntegerEnv("DESKCUE_LOG_MAX_FILES", DEFAULT_LOG_MAX_FILES);
  const maxFileSizeBytes =
    readPositiveIntegerEnv("DESKCUE_LOG_MAX_SIZE_MB", DEFAULT_LOG_MAX_SIZE_MB) * 1024 * 1024;
  let deletedFiles = 0;

  for (const fileName of readdirSync(logDirectory)) {
    if (!fileName.startsWith("daemon.jsonl.")) {
      continue;
    }
    const suffix = Number(fileName.slice("daemon.jsonl.".length));
    const filePath = join(logDirectory, fileName);
    if (
      !Number.isInteger(suffix) ||
      suffix > maxFiles ||
      readFileSize(filePath) > maxFileSizeBytes
    ) {
      rmSync(filePath, { force: true });
      deletedFiles += 1;
    }
  }

  if (existsSync(logFilePath) && readFileSize(logFilePath) > maxFileSizeBytes) {
    rotateCurrentLogFile(logFilePath, maxFiles);
  }

  for (const fileName of listRotatedDaemonLogFiles(logDirectory)) {
    if (readDataDirectoryBytes(dataDirectory) <= storageMaxBytes) {
      break;
    }
    rmSync(join(logDirectory, fileName), { force: true });
    deletedFiles += 1;
  }
  return deletedFiles;
}
