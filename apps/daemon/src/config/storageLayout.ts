import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVICE_DATA_DIRECTORY_NAME = "service";
export const LOCAL_CHAT_LIBRARY_DIRECTORY_NAME = "deskcue-chats";

export type StorageLayoutMigrationOptions = {
  dataRootPath: string;
  legacyDataRootPath?: string;
  legacyLocalChatLibraryPath?: string;
  migrateLocalChats?: boolean;
};

export function getDefaultDataRootPath() {
  return fileURLToPath(new URL("../../../../.deskcue-data/", import.meta.url));
}

export function getLegacyDaemonDataRootPath() {
  return fileURLToPath(new URL("../../.deskcue-data/", import.meta.url));
}

export function getDefaultLegacyLocalChatLibraryPath() {
  return fileURLToPath(new URL("../../deskcue-chats/", import.meta.url));
}

export function getServiceDataPath(dataRootPath: string) {
  return join(dataRootPath, SERVICE_DATA_DIRECTORY_NAME);
}

export function getLocalChatLibraryPath(dataRootPath: string) {
  return join(dataRootPath, LOCAL_CHAT_LIBRARY_DIRECTORY_NAME);
}

function moveLegacyDataRoot(dataRootPath: string, legacyDataRootPath: string) {
  if (
    !existsSync(legacyDataRootPath) ||
    resolve(legacyDataRootPath) === resolve(dataRootPath)
  ) {
    return;
  }

  if (existsSync(dataRootPath)) {
    throw new Error(
      `Cannot migrate DeskCue data root because the destination already exists: ${dataRootPath}`
    );
  }

  mkdirSync(dirname(dataRootPath), {
    recursive: true
  });
  renameSync(legacyDataRootPath, dataRootPath);
}

function moveLegacyServiceEntries(dataRootPath: string) {
  if (!existsSync(dataRootPath)) {
    return;
  }

  const legacyEntries = readdirSync(dataRootPath).filter(
    (entry) =>
      entry !== SERVICE_DATA_DIRECTORY_NAME && entry !== LOCAL_CHAT_LIBRARY_DIRECTORY_NAME
  );

  if (legacyEntries.length === 0) {
    return;
  }

  const serviceDataPath = getServiceDataPath(dataRootPath);
  mkdirSync(serviceDataPath, {
    recursive: true
  });

  for (const entry of legacyEntries) {
    const sourcePath = join(dataRootPath, entry);
    const targetPath = join(serviceDataPath, entry);

    if (existsSync(targetPath)) {
      throw new Error(
        `Cannot migrate DeskCue service data because the destination already exists: ${targetPath}`
      );
    }

    renameSync(sourcePath, targetPath);
  }
}

function moveLegacyChatLibrary(dataRootPath: string, legacyLocalChatLibraryPath: string) {
  const localChatLibraryPath = getLocalChatLibraryPath(dataRootPath);

  if (
    !existsSync(legacyLocalChatLibraryPath) ||
    resolve(legacyLocalChatLibraryPath) === resolve(localChatLibraryPath)
  ) {
    return;
  }

  if (existsSync(localChatLibraryPath)) {
    throw new Error(
      `Cannot migrate DeskCue chat library because the destination already exists: ${localChatLibraryPath}`
    );
  }

  mkdirSync(dirname(localChatLibraryPath), {
    recursive: true
  });
  renameSync(legacyLocalChatLibraryPath, localChatLibraryPath);
}

/**
 * Moves the pre-layout daemon state into `.deskcue-data/service` and the
 * former sibling chat library into `.deskcue-data/deskcue-chats`.
 *
 * The migration is intentionally rename-only. Existing destination entries
 * are never overwritten, so an ambiguous partial migration stops the daemon
 * instead of risking user data.
 */
export function migrateStorageLayout({
  dataRootPath,
  legacyDataRootPath,
  legacyLocalChatLibraryPath,
  migrateLocalChats = true
}: StorageLayoutMigrationOptions) {
  if (legacyDataRootPath) {
    moveLegacyDataRoot(dataRootPath, legacyDataRootPath);
  }
  moveLegacyServiceEntries(dataRootPath);

  if (migrateLocalChats && legacyLocalChatLibraryPath) {
    moveLegacyChatLibrary(dataRootPath, legacyLocalChatLibraryPath);
  }
}
