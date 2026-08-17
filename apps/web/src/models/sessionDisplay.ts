import type {
  AgentSessionDetail,
  SessionDetail,
  SessionLogLine,
  SessionSummary
} from "@deskcue/protocol";

export function formatManagedSessionTitle(
  session: SessionSummary | SessionDetail | null,
  takenOverAgentSession?: AgentSessionDetail | null
) {
  if (!session) {
    return "DeskCue session";
  }

  if (!session.sourceSessionId) {
    return session.command;
  }

  const title = takenOverAgentSession?.title ?? session.workspaceName;
  return title || "Agent chat";
}

export function formatManagedSessionSubtitle(
  session: SessionSummary | SessionDetail | null,
  takenOverAgentSession?: AgentSessionDetail | null
) {
  if (!session) {
    return "Waiting for session state...";
  }

  if (!session.sourceSessionId) {
    return session.workspaceName;
  }

  return takenOverAgentSession?.workspacePath ?? session.workspaceName;
}

export interface DebugLogEntry {
  id: string;
  timestamp: string;
  stream: SessionLogLine["stream"];
  text: string;
}

interface BuildDebugLogEntriesOptions {
  mode?: "taken-over" | "manual";
}

const ESC = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
const CONTROL_CHARS = `${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}-${String.fromCharCode(31)}${String.fromCharCode(127)}`;
const ANSI_OSC_PATTERN = new RegExp(`${ESC}\\][^${BELL}]*(?:${BELL}|${ESC}\\\\)`, "gu");
const ANSI_CSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "gu");
const ANSI_SINGLE_PATTERN = new RegExp(`${ESC}[@-_]`, "gu");
const CONTROL_CHAR_PATTERN = new RegExp(`[${CONTROL_CHARS}]`, "gu");
const CODEX_TUI_BORDER_PATTERN = /^[\u256d\u2570\u2502\u2500]+/;

function normalizeSystemLine(line: string, mode: "taken-over" | "manual") {
  if (!line) {
    return null;
  }

  if (mode === "taken-over") {
    if (line.startsWith("Started command:")) {
      const model = line.match(/-m "([^"]+)"/)?.[1];
      return model ? `Started Codex transport (${model})` : "Started Codex transport";
    }

    if (line.startsWith("DeskCue restarted the Codex transport")) {
      return "Restarted Codex transport for the next prompt";
    }
  }

  return line;
}

function normalizeTerminalLine(line: string, mode: "taken-over" | "manual") {
  if (!line) {
    return null;
  }

  if (CODEX_TUI_BORDER_PATTERN.test(line)) {
    return null;
  }

  if (line.includes("OpenAI Codex")) {
    return "OpenAI Codex TUI initialized";
  }

  if (line.startsWith("model:") || line.startsWith("directory:")) {
    return null;
  }

  if (line.startsWith("Tip: Try the Codex App")) {
    return null;
  }

  if (/^gpt-[^\s]+ \u00b7 /i.test(line)) {
    return null;
  }

  if (line.includes("esc to interrupt")) {
    line = line.replace(/\s*\(.*esc to interrupt\)/i, "").trim();
  }

  if (line === ">_") {
    return null;
  }

  if (mode === "taken-over") {
    const normalized = line.toLowerCase();

    if (line.startsWith("\u203a") || line.startsWith("\u2022")) {
      return null;
    }

    if (normalized.includes("openai codex")) {
      return "OpenAI Codex TUI initialized";
    }

    if (normalized.includes("starting") && normalized.includes("mcp")) {
      return "Starting MCP servers";
    }

    if (/^(Error|Warning|Update available!|Press enter to continue)/i.test(line)) {
      return line;
    }

    if (/\b(failed|failure|denied|cannot|unable|interrupt(?:ed)?|timed out|warning|error)\b/i.test(line)) {
      return line;
    }

    return null;
  }

  return line;
}

function sanitizeSystemLog(text: string, mode: "taken-over" | "manual") {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .map((line) => normalizeSystemLine(line, mode))
    .filter((line): line is string => Boolean(line));
}

function sanitizeTerminalLog(text: string, mode: "taken-over" | "manual") {
  const stripped = text
    .replace(ANSI_OSC_PATTERN, "")
    .replace(ANSI_CSI_PATTERN, "")
    .replace(ANSI_SINGLE_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CONTROL_CHAR_PATTERN, "");

  const lines = stripped
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => normalizeTerminalLine(line, mode))
    .filter((line): line is string => Boolean(line));

  return Array.from(new Set(lines));
}

function collapseDebugEntries(entries: DebugLogEntry[]) {
  return entries.filter((entry, index) => {
    const previous = entries[index - 1];
    return !previous || previous.stream !== entry.stream || previous.text !== entry.text;
  });
}

export function buildDebugLogEntries(
  logs: SessionLogLine[] | undefined,
  options: BuildDebugLogEntriesOptions = {}
) {
  const mode = options.mode ?? "manual";
  const entries: DebugLogEntry[] = [];

  for (const log of logs ?? []) {
    const lines =
      log.stream === "system"
        ? sanitizeSystemLog(log.text, mode)
        : sanitizeTerminalLog(log.text, mode);

    for (const line of lines) {
      entries.push({
        id: `${log.id}:${entries.length}`,
        timestamp: log.timestamp,
        stream: log.stream,
        text: line
      });
    }
  }

  return collapseDebugEntries(entries);
}
