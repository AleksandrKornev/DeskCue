import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import type { LocalLlmChatChangeSet } from "@deskcue/protocol";
import { AppError } from "#application/errors";

import {
  appendDurableJsonl,
  fileExists,
  mapWithConcurrency,
  readJsonl,
  writeJsonAtomic
} from "./localLlmChatFileStore.ts";
import {
  MAX_LOCAL_LLM_CHANGESET_DIFF_BYTES,
  MAX_LOCAL_LLM_CHANGESET_SIDECAR_BYTES
} from "./localLlmChatStorageLimits.ts";
import { isLocalLlmChangeSet } from "./localLlmChatStorageSchema.ts";

const CHANGE_SETS_FILE = "change-sets.jsonl";
const CHANGE_DIFFS_DIRECTORY = "change-diffs";
const CHANGE_SET_JOURNAL_FILE = "change-set-journal.json";
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

type ChangeSetJournal = { changeSet: LocalLlmChatChangeSet; sidecarFile: string };

export async function appendLocalLlmChangeSet(chatPath: string, changeSet: LocalLlmChatChangeSet) {
  if (!/^[a-z0-9-]{8,}$/i.test(changeSet.id)) throw new AppError("invalid_input", "Invalid local change set id.");
  if (Buffer.byteLength(changeSet.diff, "utf8") > MAX_LOCAL_LLM_CHANGESET_DIFF_BYTES) {
    throw new AppError("invalid_input", "Local change set exceeds the 4 MiB diff limit.");
  }
  const sidecarDirectory = path.join(chatPath, CHANGE_DIFFS_DIRECTORY);
  const storedChangeSet = { ...changeSet, diff: "", diffStorage: "gzip_sidecar" as const };
  const sidecarFile = `${changeSet.id}.patch.gz`;
  const journalPath = path.join(chatPath, CHANGE_SET_JOURNAL_FILE);
  await mkdir(sidecarDirectory, { recursive: true });
  await writeJsonAtomic(journalPath, { changeSet: storedChangeSet, sidecarFile } satisfies ChangeSetJournal);
  const compressed = await gzipAsync(Buffer.from(changeSet.diff, "utf8"));
  if (compressed.byteLength > MAX_LOCAL_LLM_CHANGESET_SIDECAR_BYTES) {
    await rm(journalPath, { force: true });
    throw new AppError("invalid_input", "Compressed local change set exceeds the 8 MiB sidecar limit.");
  }
  const destination = path.join(sidecarDirectory, sidecarFile);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, compressed);
    await rename(temporary, destination);
    await appendDurableJsonl(path.join(chatPath, CHANGE_SETS_FILE), storedChangeSet);
    await rm(journalPath, { force: true });
    return compressed.byteLength + Buffer.byteLength(`${JSON.stringify(storedChangeSet)}\n`, "utf8");
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function readLocalLlmChangeSets(chatPath: string) {
  return readJsonl(path.join(chatPath, CHANGE_SETS_FILE), isLocalLlmChangeSet);
}

export async function readLocalLlmChangeSetDiff(chatPath: string, changeSetId: string) {
  if (!/^[a-z0-9-]{8,}$/i.test(changeSetId)) throw new AppError("not_found", "Local change set not found.");
  const sidecarPath = path.join(chatPath, CHANGE_DIFFS_DIRECTORY, `${changeSetId}.patch.gz`);
  try {
    const compressed = await readFile(sidecarPath);
    if (compressed.byteLength > MAX_LOCAL_LLM_CHANGESET_SIDECAR_BYTES) {
      throw new AppError("invalid_input", "Local change set sidecar exceeds the safe read limit.");
    }
    const diff = await gunzipAsync(compressed, { maxOutputLength: MAX_LOCAL_LLM_CHANGESET_DIFF_BYTES });
    return diff.toString("utf8");
  } catch (error) {
    if (error instanceof AppError) throw error;
    const legacy = (await readLocalLlmChangeSets(chatPath)).find((changeSet) => changeSet.id === changeSetId);
    if (legacy?.diffStorage === "gzip_sidecar") throw new AppError("invalid_input", "Local change set cannot be safely decoded.");
    if (!legacy) throw new AppError("not_found", "Local change set not found.");
    if (Buffer.byteLength(legacy.diff, "utf8") > MAX_LOCAL_LLM_CHANGESET_DIFF_BYTES) {
      throw new AppError("invalid_input", "Local change set exceeds the safe read limit.");
    }
    return legacy.diff;
  }
}

function isChangeSetJournal(value: unknown): value is ChangeSetJournal {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChangeSetJournal>;
  return typeof candidate.sidecarFile === "string" && candidate.sidecarFile.endsWith(".patch.gz") &&
    isLocalLlmChangeSet(candidate.changeSet);
}

export async function recoverLocalLlmChangeSetStorage(chatPath: string) {
  const sidecarDirectory = path.join(chatPath, CHANGE_DIFFS_DIRECTORY);
  const journalPath = path.join(chatPath, CHANGE_SET_JOURNAL_FILE);
  let journal: ChangeSetJournal | null = null;
  try {
    const parsed = JSON.parse(await readFile(journalPath, "utf8")) as unknown;
    if (isChangeSetJournal(parsed)) journal = parsed;
  } catch {
    // There is normally no pending sidecar transaction.
  }
  const known = new Set((await readLocalLlmChangeSets(chatPath)).map((changeSet) => `${changeSet.id}.patch.gz`));
  if (journal) {
    const destination = path.join(sidecarDirectory, journal.sidecarFile);
    const exists = await fileExists(destination);
    if (exists && !known.has(journal.sidecarFile)) {
      await appendDurableJsonl(path.join(chatPath, CHANGE_SETS_FILE), journal.changeSet);
      known.add(journal.sidecarFile);
    }
    if (exists || known.has(journal.sidecarFile)) await rm(journalPath, { force: true });
  } else {
    await rm(journalPath, { force: true });
  }
  let entries;
  try {
    entries = await readdir(sidecarDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  await mapWithConcurrency(entries, 8, async (entry) => {
    const entryPath = path.join(sidecarDirectory, entry.name);
    if (!entry.isFile()) return;
    if (entry.name.endsWith(".tmp") || (entry.name.endsWith(".patch.gz") && !known.has(entry.name))) {
      await rm(entryPath, { force: true });
    }
  });
}
