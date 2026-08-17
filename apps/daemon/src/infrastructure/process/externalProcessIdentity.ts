export interface ExternalProcessSnapshot {
  processId: number;
  parentProcessId: number | null;
  createdAt: string;
  executablePath: string | null;
  commandLine: string | null;
}

export interface ExternalProcessIdentity {
  processId: number;
  parentProcessId: number | null;
  createdAt: string;
  executablePath: string;
  parentChain: Array<{
    processId: number;
    createdAt: string;
    executablePath: string;
  }>;
  argv: string[];
}

export type ExternalProcessIdentityValidation =
  | {
      kind: "validated";
      process: ExternalProcessIdentity;
    }
  | {
      kind: "invalid";
      reason:
        | "process_not_found"
        | "process_identity_changed"
        | "command_no_longer_matches"
        | "parent_chain_changed";
    };

export type ExternalProcessLookup =
  | { kind: "found"; process: ExternalProcessIdentity }
  | { kind: "not_found" }
  | { kind: "ambiguous" };

export type ExternalProcessMatcher = (process: ExternalProcessIdentity) => boolean;

export function parseWindowsCommandLine(commandLine: string): string[] {
  const result: string[] = [];
  let index = 0;

  while (index < commandLine.length) {
    while (/\s/.test(commandLine[index] ?? "")) index += 1;
    if (index >= commandLine.length) break;

    let value = "";
    let quoted = false;
    while (index < commandLine.length) {
      let backslashes = 0;
      while (commandLine[index] === "\\") {
        backslashes += 1;
        index += 1;
      }

      if (commandLine[index] === '"') {
        value += "\\".repeat(Math.floor(backslashes / 2));
        if (backslashes % 2 === 0) quoted = !quoted;
        else value += '"';
        index += 1;
        continue;
      }

      value += "\\".repeat(backslashes);
      const character = commandLine[index];
      if (character === undefined || (!quoted && /\s/.test(character))) break;
      value += character;
      index += 1;
    }
    result.push(value);
  }

  return result;
}

export function normalizeWindowsExecutablePath(value: string | null) {
  const normalized = value?.trim().replaceAll("/", "\\").toLowerCase();
  return normalized || null;
}

function createParentChain(
  process: ExternalProcessSnapshot,
  byProcessId: ReadonlyMap<number, ExternalProcessSnapshot>
) {
  const chain: ExternalProcessIdentity["parentChain"] = [];
  const visited = new Set<number>([process.processId]);
  let parentProcessId = process.parentProcessId;

  while (parentProcessId && parentProcessId > 0) {
    if (visited.has(parentProcessId)) return null;
    visited.add(parentProcessId);

    const parent = byProcessId.get(parentProcessId);
    if (!parent) break;
    const executablePath = normalizeWindowsExecutablePath(parent.executablePath);
    if (!executablePath) break;
    chain.push({
      processId: parent.processId,
      createdAt: parent.createdAt,
      executablePath
    });
    parentProcessId = parent.parentProcessId;
  }

  return chain;
}

function createExternalProcessIdentity(
  process: ExternalProcessSnapshot,
  byProcessId: ReadonlyMap<number, ExternalProcessSnapshot>
) {
  const executablePath = normalizeWindowsExecutablePath(process.executablePath);
  const parentChain = createParentChain(process, byProcessId);
  if (!executablePath || !parentChain) return null;

  return {
    processId: process.processId,
    parentProcessId: process.parentProcessId,
    createdAt: process.createdAt,
    executablePath,
    parentChain,
    argv: parseWindowsCommandLine(process.commandLine ?? "").slice(1)
  };
}

function hasSameParentChain(
  left: ExternalProcessIdentity["parentChain"],
  right: ExternalProcessIdentity["parentChain"]
) {
  return left.length === right.length && left.every((entry, index) => {
    const expected = right[index];
    return Boolean(
      expected &&
      entry.processId === expected.processId &&
      entry.createdAt === expected.createdAt &&
      entry.executablePath === expected.executablePath
    );
  });
}

export function findUniqueExternalProcess(
  processes: readonly ExternalProcessSnapshot[],
  matches: ExternalProcessMatcher
): ExternalProcessLookup {
  const byProcessId = new Map(processes.map((process) => [process.processId, process]));
  const matchesFound = processes
    .map((process) => createExternalProcessIdentity(process, byProcessId))
    .filter((process): process is ExternalProcessIdentity => process !== null && matches(process));

  if (matchesFound.length === 1) return { kind: "found", process: matchesFound[0] };
  return { kind: matchesFound.length === 0 ? "not_found" : "ambiguous" };
}

export function validateExternalProcessIdentity(
  expected: ExternalProcessIdentity,
  processes: readonly ExternalProcessSnapshot[],
  matches: ExternalProcessMatcher
): ExternalProcessIdentityValidation {
  const currentSnapshot = processes.find((process) => process.processId === expected.processId);
  if (!currentSnapshot) return { kind: "invalid", reason: "process_not_found" };

  const byProcessId = new Map(processes.map((process) => [process.processId, process]));
  const current = createExternalProcessIdentity(currentSnapshot, byProcessId);
  if (
    !current ||
    current.createdAt !== expected.createdAt ||
    current.executablePath !== expected.executablePath
  ) {
    return { kind: "invalid", reason: "process_identity_changed" };
  }
  if (!matches(current)) return { kind: "invalid", reason: "command_no_longer_matches" };
  if (
    current.parentProcessId !== expected.parentProcessId ||
    !hasSameParentChain(current.parentChain, expected.parentChain)
  ) {
    return { kind: "invalid", reason: "parent_chain_changed" };
  }

  return { kind: "validated", process: current };
}
