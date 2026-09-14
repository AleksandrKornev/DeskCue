import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { UpdateError } from "./errors.ts";
import type {
  UpdateArchitecture,
  UpdateArtifact,
  UpdateChannel
} from "./manifest.ts";
import { parseUpdateArtifact } from "./manifest.ts";

export const UPDATE_STATE_SCHEMA_VERSION = 1;

export type UpdatePhase =
  | "applying"
  | "available"
  | "checking"
  | "downloading"
  | "failed"
  | "idle"
  | "staged";

export type UpdateState = {
  architecture: UpdateArchitecture;
  artifact: UpdateArtifact | null;
  channel: UpdateChannel;
  currentVersion: string;
  error: {
    code: string;
    message: string;
  } | null;
  phase: UpdatePhase;
  progressBytes: number;
  schemaVersion: typeof UPDATE_STATE_SCHEMA_VERSION;
  stagedPath: string | null;
  targetVersion: string | null;
  totalBytes: number;
  updatedAt: string;
};

export type InitialUpdateStateOptions = {
  architecture: UpdateArchitecture;
  channel: UpdateChannel;
  currentVersion: string;
  now?: () => Date;
};

const UPDATE_PHASES = new Set<UpdatePhase>([
  "applying",
  "available",
  "checking",
  "downloading",
  "failed",
  "idle",
  "staged"
]);

function boundedErrorMessage(value: string) {
  return value.length <= 1_000 ? value : `${value.slice(0, 997)}...`;
}

export function createInitialUpdateState({
  architecture,
  channel,
  currentVersion,
  now = () => new Date()
}: InitialUpdateStateOptions): UpdateState {
  return {
    architecture,
    artifact: null,
    channel,
    currentVersion,
    error: null,
    phase: "idle",
    progressBytes: 0,
    schemaVersion: UPDATE_STATE_SCHEMA_VERSION,
    stagedPath: null,
    targetVersion: null,
    totalBytes: 0,
    updatedAt: now().toISOString()
  };
}

export function withUpdateFailure(
  state: UpdateState,
  error: { code: string; message: string },
  now = new Date()
): UpdateState {
  return {
    ...state,
    error: {
      code: error.code,
      message: boundedErrorMessage(error.message)
    },
    phase: "failed",
    updatedAt: now.toISOString()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertStoredState(value: unknown): asserts value is UpdateState {
  if (!isRecord(value) || value.schemaVersion !== UPDATE_STATE_SCHEMA_VERSION) {
    throw new UpdateError("invalid_state", "Stored update state has an unsupported shape.");
  }

  if (value.architecture !== "x64" && value.architecture !== "arm64") {
    throw new UpdateError("invalid_state", "Stored update architecture is unsupported.");
  }

  if (value.channel !== "stable" && value.channel !== "beta") {
    throw new UpdateError("invalid_state", "Stored update channel is unsupported.");
  }

  if (typeof value.currentVersion !== "string" || typeof value.updatedAt !== "string") {
    throw new UpdateError("invalid_state", "Stored update version metadata is invalid.");
  }

  if (typeof value.phase !== "string" || !UPDATE_PHASES.has(value.phase as UpdatePhase)) {
    throw new UpdateError("invalid_state", "Stored update phase is unsupported.");
  }

  if (!Number.isSafeInteger(value.progressBytes) || (value.progressBytes as number) < 0) {
    throw new UpdateError("invalid_state", "Stored update progress is invalid.");
  }

  if (!Number.isSafeInteger(value.totalBytes) || (value.totalBytes as number) < 0) {
    throw new UpdateError("invalid_state", "Stored update total size is invalid.");
  }

  if (value.targetVersion !== null && typeof value.targetVersion !== "string") {
    throw new UpdateError("invalid_state", "Stored target version is invalid.");
  }

  if (value.stagedPath !== null && typeof value.stagedPath !== "string") {
    throw new UpdateError("invalid_state", "Stored staged path is invalid.");
  }

  if (value.artifact !== null && !isRecord(value.artifact)) {
    throw new UpdateError("invalid_state", "Stored update artifact is invalid.");
  }

  if (value.artifact !== null) {
    try {
      parseUpdateArtifact(value.artifact);
    } catch (error) {
      throw new UpdateError("invalid_state", "Stored update artifact is invalid.", { cause: error });
    }
  }

  if (
    value.error !== null &&
    (!isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string")
  ) {
    throw new UpdateError("invalid_state", "Stored update error is invalid.");
  }
}

async function writeFileDurably(path: string, contents: string) {
  const file = await open(path, "wx");

  try {
    await file.writeFile(contents, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

export class FileUpdateStateStore {
  private operation = Promise.resolve();

  constructor(
    readonly filePath: string,
    private readonly initialState: UpdateState
  ) {}

  read(): Promise<UpdateState> {
    return this.runExclusive(async () => {
      if (!existsSync(this.filePath)) return structuredClone(this.initialState);

      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      } catch (error) {
        throw new UpdateError("invalid_state", "Stored update state is not valid JSON.", {
          cause: error
        });
      }

      assertStoredState(parsed);

      return structuredClone(parsed);
    });
  }

  write(state: UpdateState): Promise<void> {
    return this.runExclusive(async () => {
      assertStoredState(state);
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}-${randomUUID()}.tmp`;

      try {
        await writeFileDurably(temporaryPath, `${JSON.stringify(state)}\n`);
        await rename(temporaryPath, this.filePath);
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => {});
      }
    });
  }

  private runExclusive<T>(operation: () => Promise<T>) {
    const current = this.operation.then(operation, operation);

    this.operation = current.then(() => undefined, () => undefined);

    return current;
  }
}
