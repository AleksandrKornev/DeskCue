import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type ClaudeBackgroundAgentState = "working" | "blocked" | "done" | "failed" | "stopped";

export type ClaudeBackgroundAgent = {
  jobId: string | null;
  sessionId: string | null;
  kind: "background" | "interactive" | "unknown";
  state: ClaudeBackgroundAgentState | null;
  pid: number | null;
  status: string | null;
  waitingFor: string | null;
  cwd: string | null;
  startedAt: number | null;
};

export type ClaudeBackgroundControlCapability =
  | {
      kind: "claude_background_stop";
      sourceSessionId: string;
      jobId: string;
      state: "working" | "blocked";
      pid: number | null;
    }
  | {
      kind: "observe_only";
      sourceSessionId: string;
      reason:
        | "session_not_listed"
        | "control_command_unavailable"
        | "interactive_session"
        | "background_job_id_unavailable"
        | "ambiguous_background_session"
        | "session_not_interruptible";
    };

export type ClaudeBackgroundControlResult =
  | {
      kind: "listed";
      agents: ClaudeBackgroundAgent[];
    }
  | {
      kind: "command_unavailable";
      reason: "command_failed" | "invalid_json";
    };

export type ClaudeBackgroundStopResult =
  | {
      kind: "stop_requested";
      sourceSessionId: string;
      jobId: string;
    }
  | {
      kind: "control_unavailable";
      capability: Exclude<ClaudeBackgroundControlCapability, { kind: "claude_background_stop" }>;
    }
  | {
      kind: "stop_command_failed";
      sourceSessionId: string;
      jobId: string;
    };

export type ClaudeBackgroundCommand = {
  executable: string;
  args: string[];
  timeoutMs: number;
};

export type ClaudeBackgroundCommandExecutor = (
  command: ClaudeBackgroundCommand
) => Promise<{ stdout: string }>;

export type ClaudeBackgroundControlOptions = {
  executable?: string;
  includeCompleted?: boolean;
  timeoutMs?: number;
  execute?: ClaudeBackgroundCommandExecutor;
};

const execFileAsync = promisify(execFile);

export const CLAUDE_BACKGROUND_CONTROL_TIMEOUT_MS = 5_000;

const INTERRUPTIBLE_STATES = new Set<ClaudeBackgroundAgentState>(["working", "blocked"]);
const AGENT_STATES = new Set<ClaudeBackgroundAgentState>([
  "working",
  "blocked",
  "done",
  "failed",
  "stopped"
]);
const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function buildClaudeCliEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  if (environment.CLAUDE_CONFIG_DIR?.trim()) {
    return environment;
  }

  const { CLAUDE_CONFIG_DIR: _emptyClaudeConfigDirectory, ...withoutEmptyClaudeConfigDirectory } =
    environment;
  return withoutEmptyClaudeConfigDirectory;
}

async function executeClaudeCommand(command: ClaudeBackgroundCommand) {
  return execFileAsync(command.executable, command.args, {
    env: buildClaudeCliEnvironment(),
    timeout: command.timeoutMs,
    windowsHide: true,
    shell: false
  });
}

function buildWindowsClaudeCommand(args: string[]) {
  return ["claude.cmd", ...args].join(" ");
}

function observeOnly(
  sourceSessionId: string,
  reason: Extract<ClaudeBackgroundControlCapability, { kind: "observe_only" }>["reason"]
): Extract<ClaudeBackgroundControlCapability, { kind: "observe_only" }> {
  return {
    kind: "observe_only",
    sourceSessionId,
    reason
  };
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toCommand(
  input: Pick<ClaudeBackgroundControlOptions, "executable" | "timeoutMs">,
  args: string[]
): ClaudeBackgroundCommand {
  const executable = normalizeString(input.executable);
  const timeoutMs = input.timeoutMs ?? CLAUDE_BACKGROUND_CONTROL_TIMEOUT_MS;

  if (executable) {
    return {
      executable,
      args,
      timeoutMs
    };
  }

  if (process.platform === "win32") {
    return {
      executable: process.env.ComSpec?.trim() || "cmd.exe",
      // The npm-installed Claude CLI is exposed as claude.cmd on Windows. execFile
      // cannot start command scripts directly, so invoke only the trusted shim via cmd.
      args: ["/d", "/s", "/c", buildWindowsClaudeCommand(args)],
      timeoutMs
    };
  }

  return {
    executable: "claude",
    args,
    timeoutMs
  };
}

export function buildClaudeBackgroundStopCommand(input: {
  jobId: string;
  executable?: string;
  timeoutMs?: number;
}): ClaudeBackgroundCommand | null {
  const jobId = normalizeString(input.jobId);
  if (!jobId || !SAFE_JOB_ID.test(jobId)) {
    return null;
  }

  return toCommand(input, ["stop", jobId]);
}

function toPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseClaudeBackgroundAgent(value: unknown): ClaudeBackgroundAgent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawKind = normalizeString(record.kind);
  const rawState = normalizeString(record.state);
  const rawJobId = normalizeString(record.id);
  const jobId = rawJobId && SAFE_JOB_ID.test(rawJobId) ? rawJobId : null;

  return {
    jobId,
    sessionId: normalizeString(record.sessionId),
    kind: rawKind === "background" || rawKind === "interactive" ? rawKind : "unknown",
    state: rawState && AGENT_STATES.has(rawState as ClaudeBackgroundAgentState)
      ? rawState as ClaudeBackgroundAgentState
      : null,
    pid: toPositiveInteger(record.pid),
    status: normalizeString(record.status),
    waitingFor: normalizeString(record.waitingFor),
    cwd: normalizeString(record.cwd),
    startedAt: toPositiveInteger(record.startedAt)
  };
}

export function parseClaudeBackgroundAgentsJson(value: string): ClaudeBackgroundAgent[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  return parsed.flatMap((item) => {
    const agent = parseClaudeBackgroundAgent(item);
    return agent ? [agent] : [];
  });
}

export async function listClaudeBackgroundAgents(
  options: ClaudeBackgroundControlOptions = {}
): Promise<ClaudeBackgroundControlResult> {
  const command = toCommand(options, [
    "agents",
    ...(options.includeCompleted ? ["--all"] : []),
    "--json"
  ]);

  try {
    const response = await (options.execute ?? executeClaudeCommand)(command);
    const parsed = parseClaudeBackgroundAgentsJson(response.stdout);
    if (!parsed) {
      return {
        kind: "command_unavailable",
        reason: "invalid_json"
      };
    }

    return {
      kind: "listed",
      agents: parsed
    };
  } catch {
    return {
      kind: "command_unavailable",
      reason: "command_failed"
    };
  }
}

export async function findClaudeBackgroundAgent(
  sourceSessionId: string,
  options: ClaudeBackgroundControlOptions = {}
): Promise<ClaudeBackgroundAgent | null> {
  const normalizedSessionId = normalizeString(sourceSessionId);
  if (!normalizedSessionId) {
    return null;
  }

  const result = await listClaudeBackgroundAgents({
    ...options,
    includeCompleted: true
  });
  if (result.kind !== "listed") {
    return null;
  }

  const matches = result.agents.filter((agent) => agent.sessionId === normalizedSessionId);
  return matches.length === 1 && matches[0]?.kind === "background" ? matches[0] : null;
}

export async function resolveClaudeBackgroundControlCapability(
  sourceSessionId: string,
  options: ClaudeBackgroundControlOptions = {}
): Promise<ClaudeBackgroundControlCapability> {
  const normalizedSessionId = normalizeString(sourceSessionId);
  if (!normalizedSessionId) {
    return observeOnly(sourceSessionId, "session_not_listed");
  }

  const result = await listClaudeBackgroundAgents(options);
  if (result.kind !== "listed") {
    return observeOnly(normalizedSessionId, "control_command_unavailable");
  }

  const matchingAgents = result.agents.filter((agent) => agent.sessionId === normalizedSessionId);
  if (matchingAgents.length === 0) {
    return observeOnly(normalizedSessionId, "session_not_listed");
  }

  const backgroundAgents = matchingAgents.filter((agent) => agent.kind === "background");
  if (backgroundAgents.length > 1) {
    return observeOnly(normalizedSessionId, "ambiguous_background_session");
  }

  const matchingAgent = backgroundAgents[0] ?? matchingAgents[0];

  if (matchingAgent.kind !== "background") {
    return observeOnly(normalizedSessionId, "interactive_session");
  }

  if (!matchingAgent.jobId) {
    return observeOnly(normalizedSessionId, "background_job_id_unavailable");
  }

  if (
    !matchingAgent.state ||
    !INTERRUPTIBLE_STATES.has(matchingAgent.state) ||
    (matchingAgent.state !== "working" && matchingAgent.state !== "blocked")
  ) {
    return observeOnly(normalizedSessionId, "session_not_interruptible");
  }

  return {
    kind: "claude_background_stop",
    sourceSessionId: normalizedSessionId,
    jobId: matchingAgent.jobId,
    state: matchingAgent.state,
    pid: matchingAgent.pid
  };
}

export async function requestClaudeBackgroundStop(
  sourceSessionId: string,
  options: ClaudeBackgroundControlOptions = {}
): Promise<ClaudeBackgroundStopResult> {
  // Resolve immediately before stop so a recycled short job ID cannot be used from stale state.
  const capability = await resolveClaudeBackgroundControlCapability(sourceSessionId, options);
  if (capability.kind !== "claude_background_stop") {
    return {
      kind: "control_unavailable",
      capability
    };
  }

  try {
    await (options.execute ?? executeClaudeCommand)(toCommand(options, ["stop", capability.jobId]));
    return {
      kind: "stop_requested",
      sourceSessionId: capability.sourceSessionId,
      jobId: capability.jobId
    };
  } catch {
    return {
      kind: "stop_command_failed",
      sourceSessionId: capability.sourceSessionId,
      jobId: capability.jobId
    };
  }
}
