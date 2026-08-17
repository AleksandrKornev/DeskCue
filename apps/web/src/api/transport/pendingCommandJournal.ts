import { getDeskCueRuntime } from "@runtime";

import { createDeskCueCommandId } from "./commandId";

const STORAGE_KEY = "deskcue.pendingCloudCommands.v1";
const COMMAND_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_COMMANDS = 64;
const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

export type CloudCommandOperation =
  | "managed.input"
  | "managed.interrupt"
  | "managed.stop"
  | "preview.configure"
  | "preview.stop"
  | "source.attach";

export interface PendingCloudCommand {
  commandId: string;
  fingerprint: string | null;
}

interface StoredCommand {
  commandId: string;
  createdAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredCommand(value: unknown, now: number): value is StoredCommand {
  if (!isRecord(value) || typeof value.commandId !== "string" || typeof value.createdAt !== "number") {
    return false;
  }
  return value.createdAt <= now && now - value.createdAt <= COMMAND_TTL_MS;
}

function boundCommands(commands: Record<string, StoredCommand>, now: number) {
  return Object.fromEntries(
    Object.entries(commands)
      .filter((entry): entry is [string, StoredCommand] => isStoredCommand(entry[1], now))
      .sort((left, right) => right[1].createdAt - left[1].createdAt)
      .slice(0, MAX_COMMANDS)
  );
}

// localStorage carries command ownership across reloads. Keep the same bounded
// journal in memory as well: browsers can deny or exhaust persistent storage,
// but an ambiguous retry in the current tab must still reuse its command id.
let memoryCommands: Record<string, StoredCommand> = {};
let observedStorageValue: string | null | undefined;
let hasUnpersistedMemoryCommands = false;

function readCommands(now: number): Record<string, StoredCommand> {
  try {
    const storageValue = window.localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(storageValue ?? "{}") as unknown;
    let persistedCommands: Record<string, StoredCommand> = {};
    if (isRecord(parsed)) {
      persistedCommands = parsed as Record<string, StoredCommand>;
    }

    if (observedStorageValue === undefined || storageValue !== observedStorageValue) {
      // Another tab may have completed and removed a command. Persistent state
      // is authoritative whenever it changes externally; merging the stale
      // in-memory mirror here would resurrect the command id.
      memoryCommands = boundCommands(persistedCommands, now);
      hasUnpersistedMemoryCommands = false;
    } else if (hasUnpersistedMemoryCommands) {
      memoryCommands = boundCommands({
        ...persistedCommands,
        ...memoryCommands
      }, now);
    } else {
      memoryCommands = boundCommands(persistedCommands, now);
    }
    observedStorageValue = storageValue;
  } catch {
    // The in-memory mirror remains authoritative for this tab.
    memoryCommands = boundCommands(memoryCommands, now);
  }
  return { ...memoryCommands };
}

function writeCommands(commands: Record<string, StoredCommand>, now = Date.now()) {
  memoryCommands = boundCommands(commands, now);
  try {
    if (Object.keys(memoryCommands).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      observedStorageValue = null;
      hasUnpersistedMemoryCommands = false;
      return;
    }
    const storageValue = JSON.stringify(memoryCommands);
    window.localStorage.setItem(STORAGE_KEY, storageValue);
    observedStorageValue = storageValue;
    hasUnpersistedMemoryCommands = false;
  } catch {
    // The bounded in-memory journal still protects retries in this tab.
    hasUnpersistedMemoryCommands = true;
  }
}

export function isAmbiguousCloudCommandOutcome(value: unknown) {
  if (!isRecord(value)) return false;
  return value.error === "remote_control_outcome_unknown" ||
    value.code === "remote_control_outcome_unknown";
}

export function isDefinitiveCloudCommandResult(
  result: { data: unknown; ok: boolean; status?: number | null }
) {
  if (result.ok) return true;
  if (isAmbiguousCloudCommandOutcome(result.data)) return false;
  const status = result.status ?? null;
  return status !== null &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 425 &&
    status !== 429;
}

function rotateRight(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256(input: string) {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const a = words[index - 15];
      const b = words[index - 2];
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return Array.from(state, (value) => value.toString(16).padStart(8, "0")).join("");
}

export function acquirePendingCloudCommand(
  operation: CloudCommandOperation,
  targetId: string,
  payload = "",
  now = Date.now()
): PendingCloudCommand {
  const runtime = getDeskCueRuntime();
  if (runtime.mode !== "cloud-machine") {
    return { commandId: createDeskCueCommandId(), fingerprint: null };
  }

  const scope = runtime.getRealtimeScope() ?? runtime.mode;
  const fingerprint = sha256(`${scope}\u0000${operation}\u0000${targetId}\u0000${payload}`);
  const commands = readCommands(now);
  const existing = commands[fingerprint];
  if (existing) {
    return { commandId: existing.commandId, fingerprint };
  }

  const commandId = createDeskCueCommandId();
  commands[fingerprint] = { commandId, createdAt: now };
  writeCommands(commands, now);
  return { commandId, fingerprint };
}

export function clearPendingCloudCommand(command: PendingCloudCommand) {
  if (!command.fingerprint) return;
  const commands = readCommands(Date.now());
  if (commands[command.fingerprint]?.commandId !== command.commandId) return;
  delete commands[command.fingerprint];
  writeCommands(commands);
}

export function clearPendingCloudCommandForResult(
  command: PendingCloudCommand,
  result: { data: unknown; ok: boolean; status?: number | null }
) {
  if (!isDefinitiveCloudCommandResult(result)) return false;
  clearPendingCloudCommand(command);
  return true;
}
