import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { LocalLlmToolError } from "./localLlmToolTypes.ts";
import {
  assertInsideLocalLlmWorkspace,
  resolveLocalLlmWorkspacePath,
  toLocalLlmWorkspaceRelative
} from "./localLlmWorkspaceFilesystem.ts";

const JOURNAL_VERSION = 1;
const JOURNAL_FILE_NAME = "journal.json";
const PATCH_TRANSACTION_DIRECTORY = path.join(".deskcue-data", "local-llm-patches");
const MAX_JOURNAL_BYTES = 64 * 1024;
export const MAX_LOCAL_LLM_PATCH_BACKUP_BYTES = 8 * 1024 * 1024;
const workspaceQueues = new Map<string, Promise<void>>();

export type LocalLlmUnifiedDiffFilePlan = {
  nextContent: string | null;
  path: string;
  previousContent: string | null;
  relativePath: string;
};

export type LocalLlmUnifiedDiffCommitOperations = {
  mkdir: typeof mkdir;
  rename: typeof rename;
  rm: typeof rm;
  rmdir?: typeof rmdir;
  unlink: typeof unlink;
  writeFile: typeof writeFile;
};

type JournalEntry = {
  backupBytes: number;
  backupFile: string | null;
  backupSha256: string | null;
  relativePath: string;
};

type PatchJournal = {
  createdDirectories: string[];
  entries: JournalEntry[];
  version: 1;
};

export const defaultLocalLlmUnifiedDiffCommitOperations: LocalLlmUnifiedDiffCommitOperations = {
  mkdir,
  rename,
  rm,
  rmdir,
  unlink,
  writeFile
};

export async function withLocalLlmWorkspacePatchLock<T>(root: string, task: () => Promise<T>) {
  const previous = workspaceQueues.get(root) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  workspaceQueues.set(root, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (workspaceQueues.get(root) === tail) workspaceQueues.delete(root);
  }
}

async function readBoundedFile(filePath: string, maxBytes: number) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
    if (bytesRead > maxBytes) throw new LocalLlmToolError("Local patch recovery file exceeds its limit.");
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function writeDurableFile(
  filePath: string,
  content: string | Uint8Array,
  operations: LocalLlmUnifiedDiffCommitOperations
) {
  await operations.writeFile(filePath, content);
  const handle = await open(filePath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertSafeWritableParent(root: string, targetPath: string) {
  let parent = path.dirname(targetPath);
  while (parent !== root) {
    try {
      const canonical = await realpath(parent);
      assertInsideLocalLlmWorkspace(root, canonical);
      return;
    } catch (error) {
      if (error instanceof LocalLlmToolError) throw error;
      parent = path.dirname(parent);
    }
  }
}

async function removeEmptyTransactionRoot(
  transactionRoot: string,
  operations: LocalLlmUnifiedDiffCommitOperations
) {
  const removeDirectory = operations.rmdir ?? rmdir;
  await removeDirectory(transactionRoot).catch(() => undefined);
  await removeDirectory(path.dirname(transactionRoot)).catch(() => undefined);
}

async function syncDirectoryBestEffort(directoryPath: string) {
  try {
    const handle = await open(directoryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is unavailable on some supported Windows filesystems.
  }
}

async function writeJournal(
  transactionDirectory: string,
  journal: PatchJournal,
  operations: LocalLlmUnifiedDiffCommitOperations
) {
  const temporaryPath = path.join(transactionDirectory, `${JOURNAL_FILE_NAME}.tmp`);
  await writeDurableFile(temporaryPath, JSON.stringify(journal), operations);
  await operations.rename(temporaryPath, path.join(transactionDirectory, JOURNAL_FILE_NAME));
  await syncDirectoryBestEffort(transactionDirectory);
}

function isSafeRelativePath(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !path.isAbsolute(value)
    && path.normalize(value) !== "." && !value.split(/[\\/]+/).includes("..");
}

function isPatchJournal(value: unknown): value is PatchJournal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PatchJournal>;
  if (candidate.version !== JOURNAL_VERSION || !Array.isArray(candidate.entries)
    || !Array.isArray(candidate.createdDirectories) || candidate.entries.length > 100) return false;
  const paths = new Set<string>();
  for (const entry of candidate.entries) {
    if (!entry || typeof entry !== "object" || !isSafeRelativePath(entry.relativePath)
      || paths.has(entry.relativePath) || !Number.isSafeInteger(entry.backupBytes)
      || entry.backupBytes < 0 || entry.backupBytes > MAX_LOCAL_LLM_PATCH_BACKUP_BYTES) return false;
    paths.add(entry.relativePath);
    if (entry.backupFile === null) {
      if (entry.backupBytes !== 0 || entry.backupSha256 !== null) return false;
    } else if (!/^backup-\d+\.txt$/.test(entry.backupFile)
      || typeof entry.backupSha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.backupSha256)) return false;
  }
  return candidate.createdDirectories.every(isSafeRelativePath);
}

function backupFileName(index: number) {
  return `backup-${index}.txt`;
}

function nextFileName(index: number) {
  return `next-${index}.tmp`;
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function readVerifiedBackup(
  transactionDirectory: string,
  backupPath: string,
  entry: JournalEntry
) {
  const canonicalBackupPath = await realpath(backupPath);
  assertInsideLocalLlmWorkspace(transactionDirectory, canonicalBackupPath);
  const backup = await readBoundedFile(canonicalBackupPath, entry.backupBytes);
  if (backup.byteLength !== entry.backupBytes || sha256(backup) !== entry.backupSha256) {
    throw new LocalLlmToolError("Local patch recovery backup failed its integrity check.");
  }
  return backup;
}

async function safeLstat(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function resolveTransactionRoot(
  root: string,
  create: true,
  operations: LocalLlmUnifiedDiffCommitOperations
): Promise<string>;
async function resolveTransactionRoot(
  root: string,
  create: false,
  operations: LocalLlmUnifiedDiffCommitOperations
): Promise<string | null>;
async function resolveTransactionRoot(
  root: string,
  create: boolean,
  operations: LocalLlmUnifiedDiffCommitOperations
) {
  const deskcueData = path.join(root, ".deskcue-data");
  const transactionRoot = path.join(root, PATCH_TRANSACTION_DIRECTORY);
  for (const directoryPath of [deskcueData, transactionRoot]) {
    const entry = await safeLstat(directoryPath);
    if (entry?.isSymbolicLink() || (entry && !entry.isDirectory())) {
      throw new LocalLlmToolError("Local patch recovery storage must be a real workspace directory.");
    }
    if (!entry) {
      if (!create) return null;
      await operations.mkdir(directoryPath, { recursive: false }).catch(async (error) => {
        if (!(await safeLstat(directoryPath))?.isDirectory()) throw error;
      });
    }
    const canonical = await realpath(directoryPath);
    assertInsideLocalLlmWorkspace(root, canonical);
  }
  return transactionRoot;
}

async function collectMissingParentDirectories(root: string, targetPath: string) {
  const missing: string[] = [];
  let current = path.dirname(targetPath);
  while (current !== root) {
    const entry = await safeLstat(current);
    if (entry) break;
    missing.push(current);
    current = path.dirname(current);
  }
  return missing;
}

async function prepareTransaction(
  root: string,
  transactionDirectory: string,
  plans: LocalLlmUnifiedDiffFilePlan[],
  operations: LocalLlmUnifiedDiffCommitOperations
) {
  const entries: JournalEntry[] = [];
  const createdDirectories = new Set<string>();
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    assertInsideLocalLlmWorkspace(root, plan.path);
    let backupFile: string | null = null;
    let backupSha256: string | null = null;
    let backupBytes = 0;
    if (plan.previousContent !== null) {
      backupFile = backupFileName(index);
      const backup = Buffer.from(plan.previousContent, "utf8");
      backupBytes = backup.byteLength;
      if (backupBytes > MAX_LOCAL_LLM_PATCH_BACKUP_BYTES) {
        throw new LocalLlmToolError("Patch source exceeds the crash-recovery backup limit.");
      }
      backupSha256 = sha256(backup);
      await writeDurableFile(path.join(transactionDirectory, backupFile), backup, operations);
    }
    if (plan.nextContent !== null) {
      await writeDurableFile(
        path.join(transactionDirectory, nextFileName(index)),
        plan.nextContent,
        operations
      );
      for (const directoryPath of await collectMissingParentDirectories(root, plan.path)) {
        createdDirectories.add(toLocalLlmWorkspaceRelative(root, directoryPath));
      }
    }
    entries.push({ backupBytes, backupFile, backupSha256, relativePath: plan.relativePath });
  }
  return {
    createdDirectories: [...createdDirectories].sort((left, right) => right.length - left.length),
    entries,
    version: JOURNAL_VERSION
  } satisfies PatchJournal;
}

async function pathExists(filePath: string) {
  return Boolean(await safeLstat(filePath));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readJournal(transactionDirectory: string): Promise<PatchJournal> {
  const journalPath = path.join(transactionDirectory, JOURNAL_FILE_NAME);
  const journalStat = await stat(journalPath);
  if (!journalStat.isFile() || journalStat.size > MAX_JOURNAL_BYTES) {
    throw new LocalLlmToolError("Local patch recovery journal is invalid or too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse((await readBoundedFile(journalPath, MAX_JOURNAL_BYTES)).toString("utf8"));
  } catch (error) {
    throw new LocalLlmToolError(`Local patch recovery journal is unreadable: ${errorMessage(error)}`);
  }
  if (!isPatchJournal(value)) {
    throw new LocalLlmToolError("Local patch recovery journal has an invalid schema.");
  }
  return value;
}

async function recoverTransaction(
  root: string,
  transactionDirectory: string,
  operations: LocalLlmUnifiedDiffCommitOperations
) {
  const canonicalTransactionDirectory = await realpath(transactionDirectory);
  assertInsideLocalLlmWorkspace(path.dirname(transactionDirectory), canonicalTransactionDirectory);
  const journal = await readJournal(canonicalTransactionDirectory);
  for (let index = 0; index < journal.entries.length; index += 1) {
    const entry = journal.entries[index];
    const targetPath = resolveLocalLlmWorkspacePath(root, entry.relativePath);
    await assertSafeWritableParent(root, targetPath);
    if (entry.backupFile === null) {
      await operations.rm(targetPath, { force: true });
      await syncDirectoryBestEffort(path.dirname(targetPath));
      continue;
    }
    const backupPath = path.join(canonicalTransactionDirectory, entry.backupFile);
    const backup = await readVerifiedBackup(canonicalTransactionDirectory, backupPath, entry);
    const restorePath = path.join(canonicalTransactionDirectory, `restore-${index}-${randomUUID()}.tmp`);
    await writeDurableFile(restorePath, backup, operations);
    await operations.mkdir(path.dirname(targetPath), { recursive: true });
    await operations.rename(restorePath, targetPath);
    await syncDirectoryBestEffort(path.dirname(targetPath));
  }
  for (const relativeDirectory of journal.createdDirectories) {
    const directoryPath = resolveLocalLlmWorkspacePath(root, relativeDirectory);
    await (operations.rmdir ?? rmdir)(directoryPath).catch(() => undefined);
  }
  await operations.unlink(path.join(canonicalTransactionDirectory, JOURNAL_FILE_NAME));
  await operations.rm(canonicalTransactionDirectory, { force: true, recursive: true });
}

/**
 * Commits a patch through a durable rollback journal. A process or machine
 * failure can still interrupt filesystem operations, so this is intentionally
 * described as crash-recoverable rather than as an absolute FS transaction.
 */
export async function commitLocalLlmUnifiedDiffPlans(
  root: string,
  plans: LocalLlmUnifiedDiffFilePlan[],
  operations: LocalLlmUnifiedDiffCommitOperations
) {
  const transactionRoot = await resolveTransactionRoot(root, true, operations);
  const transactionDirectory = path.join(transactionRoot, randomUUID());
  assertInsideLocalLlmWorkspace(root, transactionDirectory);
  await operations.mkdir(transactionDirectory, { recursive: false });

  let journalPrepared = false;
  let journalFinished = false;
  try {
    const journal = await prepareTransaction(root, transactionDirectory, plans, operations);
    await writeJournal(transactionDirectory, journal, operations);
    journalPrepared = true;

    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      await assertSafeWritableParent(root, plan.path);
      if (plan.nextContent === null) {
        await operations.unlink(plan.path);
        await syncDirectoryBestEffort(path.dirname(plan.path));
        continue;
      }
      await operations.mkdir(path.dirname(plan.path), { recursive: true });
      await operations.rename(path.join(transactionDirectory, nextFileName(index)), plan.path);
      await syncDirectoryBestEffort(path.dirname(plan.path));
    }

    // Removing the journal is the commit point. If the daemon dies before
    // this unlink, the next recovery restores every original file. Anything
    // left after it is an orphaned internal directory and can be discarded.
    await operations.unlink(path.join(transactionDirectory, JOURNAL_FILE_NAME));
    journalFinished = true;
    await syncDirectoryBestEffort(transactionDirectory);
  } catch (error) {
    if (journalPrepared) {
      try {
        await recoverTransaction(root, transactionDirectory, operations);
        journalFinished = true;
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          `Patch commit failed and its durable rollback also failed: ${errorMessage(error)}`
        );
      }
    }
    throw error;
  } finally {
    if (!journalPrepared || journalFinished) {
      await operations.rm(transactionDirectory, { force: true, recursive: true }).catch(() => undefined);
      await removeEmptyTransactionRoot(transactionRoot, operations);
    }
  }
}

export async function recoverLocalLlmUnifiedDiffTransactions(
  root: string,
  operations: LocalLlmUnifiedDiffCommitOperations
) {
  const transactionRoot = await resolveTransactionRoot(root, false, operations);
  if (!transactionRoot) return;
  const directory = await opendir(transactionRoot);
  for await (const entry of directory) {
    const transactionDirectory = path.join(transactionRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new LocalLlmToolError("Local patch recovery directory cannot contain symbolic links.");
    }
    if (!entry.isDirectory()) continue;
    const journalPath = path.join(transactionDirectory, JOURNAL_FILE_NAME);
    if (!(await pathExists(journalPath))) {
      await operations.rm(transactionDirectory, { force: true, recursive: true });
      continue;
    }
    await recoverTransaction(root, transactionDirectory, operations);
  }
  await removeEmptyTransactionRoot(transactionRoot, operations);
}
