import {
  appendFile,
  mkdir,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { dirname } from "node:path";

type AsyncRotatingFileDestinationOptions = {
  filePath: string;
  maxBatchBytes: number;
  maxFileSizeBytes: number;
  maxFiles: number;
  maxQueueBytes: number;
  reportError: (message: string) => void;
};

type QueueEntry = {
  bytes: Buffer;
  sequence: number;
};

type FlushWaiter = {
  resolve: () => void;
  targetSequence: number;
};

export type AsyncRotatingFileDestination = {
  close(): Promise<void>;
  flush(): Promise<void>;
  write(message: string): boolean;
};

function takeBatch(queue: QueueEntry[], startIndex: number, maxBatchBytes: number) {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let currentIndex = startIndex;
  let lastSequence = queue[startIndex]?.sequence ?? 0;

  while (currentIndex < queue.length) {
    const entry = queue[currentIndex];
    if (!entry) {
      break;
    }
    if (chunks.length > 0 && byteLength + entry.bytes.length > maxBatchBytes) {
      break;
    }

    chunks.push(entry.bytes);
    byteLength += entry.bytes.length;
    lastSequence = entry.sequence;
    currentIndex += 1;
  }

  return {
    bytes: chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, byteLength),
    lastSequence,
    nextIndex: currentIndex
  };
}

async function initializeLogDirectory(filePath: string, maxFiles: number) {
  await mkdir(dirname(filePath), {
    recursive: true
  });
  await Promise.all(
    Array.from({ length: 20 }, (_, offset) =>
      rm(`${filePath}.${maxFiles + offset + 1}`, {
        force: true
      })
    )
  );
}

function readErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}

async function readFileSize(filePath: string) {
  try {
    return (await stat(filePath)).size;
  } catch (error) {
    if (readErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function renameIfPresent(source: string, target: string) {
  try {
    await rename(source, target);
  } catch (error) {
    if (readErrorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

async function rotateLogFileIfNeeded({
  filePath,
  incomingBytes,
  maxFileSizeBytes,
  maxFiles
}: {
  filePath: string;
  incomingBytes: number;
  maxFileSizeBytes: number;
  maxFiles: number;
}) {
  if (maxFileSizeBytes <= 0 || maxFiles <= 0) {
    return;
  }

  const currentSize = await readFileSize(filePath);
  if (currentSize === null || currentSize + incomingBytes <= maxFileSizeBytes) {
    return;
  }

  await rm(`${filePath}.${maxFiles}`, {
    force: true
  });
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    await renameIfPresent(`${filePath}.${index}`, `${filePath}.${index + 1}`);
  }
  await renameIfPresent(filePath, `${filePath}.1`);
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createAsyncRotatingFileDestination({
  filePath,
  maxBatchBytes,
  maxFileSizeBytes,
  maxFiles,
  maxQueueBytes,
  reportError
}: AsyncRotatingFileDestinationOptions): AsyncRotatingFileDestination {
  let acceptingWrites = true;
  let acceptedSequence = 0;
  let completedSequence = 0;
  let bufferedBytes = 0;
  let closePromise: Promise<void> | null = null;
  let droppedSinceWarning = 0;
  let pumpPromise: Promise<void> | null = null;
  let queueHead = 0;
  let warningScheduled = false;
  const queue: QueueEntry[] = [];
  const flushWaiters: FlushWaiter[] = [];
  const initialized = initializeLogDirectory(filePath, maxFiles).catch((error) => {
    reportError(`failed to initialize log file: ${readErrorMessage(error)}`);
  });

  function resolveFlushWaiters() {
    for (let index = flushWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = flushWaiters[index];
      if (!waiter || completedSequence < waiter.targetSequence) {
        continue;
      }

      flushWaiters.splice(index, 1);
      waiter.resolve();
    }
  }

  async function pumpQueue() {
    await initialized;

    while (queueHead < queue.length) {
      const batch = takeBatch(queue, queueHead, maxBatchBytes);
      queueHead = batch.nextIndex;

      try {
        await rotateLogFileIfNeeded({
          filePath,
          incomingBytes: batch.bytes.length,
          maxFileSizeBytes,
          maxFiles
        });
      } catch (error) {
        reportError(`failed to rotate log file: ${readErrorMessage(error)}`);
      }

      try {
        await appendFile(filePath, batch.bytes);
      } catch (error) {
        reportError(`failed to write log file: ${readErrorMessage(error)}`);
      } finally {
        bufferedBytes -= batch.bytes.length;
        completedSequence = batch.lastSequence;
        resolveFlushWaiters();
      }
    }
  }

  function compactQueue() {
    if (queueHead === 0) {
      return;
    }

    queue.splice(0, queueHead);
    queueHead = 0;
  }

  function completeRemainingEntries() {
    const lastEntry = queue.at(-1);
    if (!lastEntry) {
      return;
    }

    for (let index = queueHead; index < queue.length; index += 1) {
      bufferedBytes -= queue[index]?.bytes.length ?? 0;
    }
    queueHead = queue.length;
    completedSequence = lastEntry.sequence;
  }

  function startPump() {
    if (pumpPromise || queueHead >= queue.length) {
      return;
    }

    pumpPromise = pumpQueue()
      .catch((error) => {
        reportError(`failed to process log queue: ${readErrorMessage(error)}`);
        completeRemainingEntries();
      })
      .finally(() => {
        pumpPromise = null;
        compactQueue();
        resolveFlushWaiters();
        if (queueHead < queue.length) {
          startPump();
        }
      });
  }

  function waitForSequence(targetSequence: number) {
    if (completedSequence >= targetSequence) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      flushWaiters.push({
        resolve,
        targetSequence
      });
      startPump();
    });
  }

  function scheduleDropWarning(count: number, reason: string) {
    droppedSinceWarning += count;
    if (warningScheduled) {
      return;
    }

    warningScheduled = true;
    queueMicrotask(() => {
      const dropped = droppedSinceWarning;
      droppedSinceWarning = 0;
      warningScheduled = false;
      reportError(`dropped ${dropped} log message(s) because ${reason}`);
    });
  }

  return {
    write(message) {
      if (!acceptingWrites) {
        scheduleDropWarning(1, "the logger is closed");
        return false;
      }

      const bytes = Buffer.from(message);
      if (bytes.length > maxQueueBytes || bufferedBytes + bytes.length > maxQueueBytes) {
        scheduleDropWarning(1, `the ${maxQueueBytes}-byte queue is full`);
        return false;
      }

      acceptedSequence += 1;
      bufferedBytes += bytes.length;
      queue.push({
        bytes,
        sequence: acceptedSequence
      });
      startPump();
      return bufferedBytes < maxQueueBytes;
    },
    flush() {
      const targetSequence = acceptedSequence;
      if (completedSequence >= targetSequence) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        flushWaiters.push({
          resolve,
          targetSequence
        });
        startPump();
      });
    },
    close() {
      if (closePromise) {
        return closePromise;
      }

      acceptingWrites = false;
      const targetSequence = acceptedSequence;
      closePromise = Promise.all([initialized, waitForSequence(targetSequence)]).then(
        () => undefined
      );
      return closePromise;
    }
  };
}
