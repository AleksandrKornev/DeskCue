import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { SourceAgentTurnState } from "#agents/sourceAgentTurnState";
import { logger } from "#infrastructure/logging/logger";

export type TrackedAgentSessionTurnState = {
  observedAt: string;
  owner: "external" | "managed";
  /**
   * Terminal lifecycle entries observed in the current bounded transcript
   * window. Keeping these separately from the current state prevents a new
   * prompt from masking the completion that immediately preceded it.
   */
  observedTerminalFingerprints?: string[];
  state: SourceAgentTurnState;
};

type PersistedAgentSessionTurnStateRecord = TrackedAgentSessionTurnState & {
  id: string;
};

type PersistedAgentSessionTurnStateFile = {
  sessions?: unknown;
  updatedAt?: unknown;
  version?: unknown;
};

const TURN_STATE_STORAGE_MAX_RECORDS = 200;
const TURN_STATE_STORAGE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeObservedTerminalFingerprints(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return Array.from(new Set(
    value.filter((item): item is string => typeof item === "string" && item.length > 0)
  )).slice(-64);
}

function isActiveTurnEvidence(
  value: unknown
): value is Extract<SourceAgentTurnState, { phase: "active" }>["evidence"] {
  return (
    value === "recent_non_final_activity" ||
    value === "turn_lifecycle" ||
    value === "unanswered_user_turn" ||
    value === "user_after_terminal"
  );
}

function isTerminalTurnPhase(
  phase: unknown
): phase is Extract<
  SourceAgentTurnState["phase"],
  "completed" | "failed" | "interrupted"
> {
  return phase === "completed" || phase === "failed" || phase === "interrupted";
}

function normalizeSourceAgentTurnState(input: unknown): SourceAgentTurnState | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const state = input as Record<string, unknown>;
  if (
    state.phase === "idle" &&
    (state.fingerprint === null || typeof state.fingerprint === "string")
  ) {
    return {
      evidence: state.evidence === "none" ? state.evidence : "none",
      fingerprint: state.fingerprint,
      phase: "idle"
    };
  }

  if (
    state.phase === "active" &&
    typeof state.activityAt === "string" &&
    typeof state.fingerprint === "string" &&
    typeof state.startedAt === "string"
  ) {
    return {
      activityAt: state.activityAt,
      evidence: isActiveTurnEvidence(state.evidence)
        ? state.evidence
        : "turn_lifecycle",
      fingerprint: state.fingerprint,
      phase: "active",
      startedAt: state.startedAt
    };
  }

  if (
    isTerminalTurnPhase(state.phase) &&
    typeof state.completedAt === "string" &&
    typeof state.fingerprint === "string"
  ) {
    return {
      completedAt: state.completedAt,
      evidence:
        state.evidence === "terminal_lifecycle"
          ? state.evidence
          : "terminal_lifecycle",
      fingerprint: state.fingerprint,
      phase: state.phase,
      turnStartFingerprint:
        typeof state.turnStartFingerprint === "string"
          ? state.turnStartFingerprint
          : null
    };
  }

  return null;
}

function isTrackedOwner(value: unknown): value is TrackedAgentSessionTurnState["owner"] {
  return value === "external" || value === "managed";
}

function isExpiredPersistedTurnState(observedAt: string) {
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) {
    return true;
  }

  return Date.now() - observedAtMs > TURN_STATE_STORAGE_TTL_MS;
}

function normalizePersistedAgentSessionTurnStateRecord(
  input: unknown
): PersistedAgentSessionTurnStateRecord | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.observedAt !== "string" ||
    isExpiredPersistedTurnState(record.observedAt) ||
    !isTrackedOwner(record.owner)
  ) {
    return null;
  }
  const state = normalizeSourceAgentTurnState(record.state);
  if (!state) {
    return null;
  }

  return {
    id: record.id,
    observedAt: record.observedAt,
    observedTerminalFingerprints: normalizeObservedTerminalFingerprints(
      record.observedTerminalFingerprints
    ),
    owner: record.owner,
    state
  };
}

function isFileNotFound(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
  );
}

async function readPersistedAgentSessionTurnStates(
  storagePath: string
): Promise<PersistedAgentSessionTurnStateRecord[]> {
  try {
    const raw = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(raw) as PersistedAgentSessionTurnStateFile;
    if (!Array.isArray(parsed.sessions)) {
      return [];
    }

    return parsed.sessions
      .map(normalizePersistedAgentSessionTurnStateRecord)
      .filter((record): record is PersistedAgentSessionTurnStateRecord => Boolean(record));
  } catch (error) {
    if (isFileNotFound(error)) {
      return [];
    }

    throw error;
  }
}

async function writePersistedAgentSessionTurnStates(
  storagePath: string,
  states: Map<string, TrackedAgentSessionTurnState>
) {
  const sessions = Array.from(states.entries())
    .map(([id, state]) => ({
      id,
      observedAt: state.observedAt,
      ...(state.observedTerminalFingerprints
        ? { observedTerminalFingerprints: state.observedTerminalFingerprints }
        : {}),
      owner: state.owner,
      state: state.state
    }))
    .filter((record) => !isExpiredPersistedTurnState(record.observedAt))
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
    .slice(0, TURN_STATE_STORAGE_MAX_RECORDS);

  await mkdir(dirname(storagePath), { recursive: true });
  const tempFilePath = join(
    dirname(storagePath),
    `agent-session-turn-states.${randomUUID()}.tmp`
  );
  await writeFile(
    tempFilePath,
    JSON.stringify(
      {
        sessions,
        updatedAt: new Date().toISOString(),
        version: 1
      },
      null,
      2
    ),
    "utf8"
  );
  await rename(tempFilePath, storagePath);
}

function serializeTrackedTurnState(state: TrackedAgentSessionTurnState) {
  return JSON.stringify({
    observedTerminalFingerprints: state.observedTerminalFingerprints ?? [],
    owner: state.owner,
    state: state.state
  });
}

export class AgentSessionTurnStateRepository {
  private readonly states = new Map<string, TrackedAgentSessionTurnState>();
  private loaded = false;
  private dirty = false;

  constructor(private readonly storagePath: string | null) {}

  get(sessionId: string) {
    return this.states.get(sessionId);
  }

  set(sessionId: string, state: TrackedAgentSessionTurnState) {
    const previous = this.states.get(sessionId);
    this.states.set(sessionId, state);
    if (!previous || serializeTrackedTurnState(previous) !== serializeTrackedTurnState(state)) {
      this.dirty = true;
    }
    return previous;
  }

  delete(sessionId: string) {
    if (this.states.delete(sessionId)) {
      this.dirty = true;
    }
  }

  keys() {
    return this.states.keys();
  }

  async loadIfNeeded() {
    if (this.loaded || !this.storagePath) {
      return;
    }

    this.loaded = true;
    try {
      const records = await readPersistedAgentSessionTurnStates(this.storagePath);
      for (const record of records) {
        if (!this.states.has(record.id)) {
          this.states.set(record.id, {
            observedAt: record.observedAt,
            observedTerminalFingerprints: record.observedTerminalFingerprints,
            owner: record.owner,
            state: record.state
          });
        }
      }
    } catch (error) {
      logger.warn("Failed to load source-agent turn state cache", {
        message: error instanceof Error ? error.message : String(error),
        storagePath: this.storagePath
      });
    }
  }

  async persistIfDirty() {
    return this.dirty ? this.persist() : true;
  }

  async persist() {
    if (!this.storagePath) {
      this.dirty = false;
      return true;
    }

    try {
      await writePersistedAgentSessionTurnStates(this.storagePath, this.states);
      this.dirty = false;
      return true;
    } catch (error) {
      logger.warn("Failed to persist source-agent turn state cache", {
        message: error instanceof Error ? error.message : String(error),
        storagePath: this.storagePath
      });
      return false;
    }
  }
}
