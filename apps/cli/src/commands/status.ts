import type { HostStatus } from "@deskcue/host-control";

import type { HostRequest } from "../host/hostClient.ts";
import { readOptionalHostStatus } from "../host/hostClient.ts";
import { sanitizeTerminalLine } from "../output.ts";
import { formatUpdateError } from "./update.ts";

const CLI_STATUS_MAX_RESPONSE_BYTES = 64 * 1024;
const CLI_STATUS_TIMEOUT_MS = 5_000;

export type CliStatusSnapshot = {
  activeChatCount: number;
  activeChatCountExact: boolean;
  chatCount: number;
  chatCountExact: boolean;
  generatedAt: string;
  lastChat: {
    id: string;
    model: string | null;
    sourceId: string;
    sourceLabel: string;
    title: string;
    updatedAt: string;
    workspaceName: string | null;
  } | null;
  runtimes: Array<{
    activeChatCount: number;
    activeChatCountExact: boolean;
    chatCount: number;
    chatCountExact: boolean;
    id: "claude-code" | "codex" | "generic-cli" | "lm-studio" | "ollama";
    installed: boolean;
    label: string;
    lastActiveModel: string | null;
    loadedModelCount: number;
    modelCount: number;
    running: boolean;
    statusText: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function isRuntimeId(value: unknown): value is CliStatusSnapshot["runtimes"][number]["id"] {
  return value === "claude-code" || value === "codex" || value === "generic-cli" ||
    value === "lm-studio" || value === "ollama";
}

function isCliRuntimeStatus(value: unknown): value is CliStatusSnapshot["runtimes"][number] {
  if (!isRecord(value)) return false;

  return isNonNegativeInteger(value.activeChatCount) &&
    typeof value.activeChatCountExact === "boolean" &&
    isNonNegativeInteger(value.chatCount) &&
    (value.activeChatCount as number) <= (value.chatCount as number) &&
    typeof value.chatCountExact === "boolean" &&
    isRuntimeId(value.id) &&
    typeof value.installed === "boolean" &&
    typeof value.label === "string" &&
    isNullableString(value.lastActiveModel) &&
    isNonNegativeInteger(value.loadedModelCount) &&
    isNonNegativeInteger(value.modelCount) &&
    typeof value.running === "boolean" &&
    typeof value.statusText === "string";
}

function isCliLastChat(value: unknown): value is NonNullable<CliStatusSnapshot["lastChat"]> {
  if (!isRecord(value)) return false;

  return typeof value.id === "string" &&
    isNullableString(value.model) &&
    typeof value.sourceId === "string" &&
    typeof value.sourceLabel === "string" &&
    typeof value.title === "string" &&
    typeof value.updatedAt === "string" &&
    isNullableString(value.workspaceName);
}

function parseCliStatusSnapshot(value: unknown): CliStatusSnapshot {
  if (!isRecord(value) ||
    !isNonNegativeInteger(value.activeChatCount) ||
    typeof value.activeChatCountExact !== "boolean" ||
    !isNonNegativeInteger(value.chatCount) ||
    typeof value.chatCountExact !== "boolean" ||
    typeof value.generatedAt !== "string" ||
    (value.lastChat !== null && !isCliLastChat(value.lastChat)) ||
    !Array.isArray(value.runtimes) ||
    value.runtimes.length > 8 ||
    !value.runtimes.every(isCliRuntimeStatus)) {
    throw new Error("DeskCue daemon returned an invalid CLI status snapshot.");
  }

  const runtimes = value.runtimes as CliStatusSnapshot["runtimes"];
  const runtimeIds = new Set(runtimes.map((runtime) => runtime.id));
  const runtimeChatCount = runtimes.reduce((total, runtime) => total + runtime.chatCount, 0);
  const runtimeActiveChatCount = runtimes.reduce((total, runtime) => total + runtime.activeChatCount, 0);

  if ((value.activeChatCount as number) > (value.chatCount as number) ||
    runtimeIds.size !== runtimes.length ||
    runtimeChatCount !== value.chatCount ||
    runtimeActiveChatCount !== value.activeChatCount) {
    throw new Error("DeskCue daemon returned an inconsistent CLI status snapshot.");
  }

  return value as CliStatusSnapshot;
}

function assertLoopbackDaemonUrl(value: string) {
  const url = new URL(value);

  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]")) {
    throw new Error("DeskCue daemon reported an unsafe local URL.");
  }

  return url;
}

async function readBoundedJson(response: Response) {
  if (!response.ok) throw new Error(`DeskCue daemon status request failed with HTTP ${response.status}.`);
  if (!response.body) throw new Error("DeskCue daemon status response was empty.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) break;

    totalBytes += chunk.value.byteLength;
    if (totalBytes > CLI_STATUS_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("DeskCue daemon status response exceeded the safe size limit.");
    }

    chunks.push(chunk.value);
  }

  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");

  return JSON.parse(body) as unknown;
}

function formatRelativeTime(timestamp: string, now: number) {
  const elapsedMs = now - Date.parse(timestamp);

  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return sanitizeTerminalLine(timestamp);
  if (elapsedMs < 60_000) return "just now";
  if (elapsedMs < 60 * 60_000) return `${Math.floor(elapsedMs / 60_000)}m ago`;
  if (elapsedMs < 24 * 60 * 60_000) return `${Math.floor(elapsedMs / (60 * 60_000))}h ago`;

  return `${Math.floor(elapsedMs / (24 * 60 * 60_000))}d ago`;
}

function formatRuntimeState(runtime: CliStatusSnapshot["runtimes"][number]) {
  if (!runtime.installed) return "MISSING";
  if (runtime.running) return "READY";
  if (runtime.id === "codex" || runtime.id === "claude-code" || runtime.id === "generic-cli") return "AVAILABLE";

  return "OFFLINE";
}

function formatRuntimeCount(runtime: CliStatusSnapshot["runtimes"][number]) {
  const chatSuffix = runtime.chatCountExact ? "" : "+";
  const activeSuffix = runtime.activeChatCountExact ? "" : "+";
  const chats = `${runtime.chatCount}${chatSuffix} chat${runtime.chatCount === 1 ? "" : "s"}`;
  const active = runtime.activeChatCount > 0 ? `, ${runtime.activeChatCount}${activeSuffix} active` : "";
  const models = runtime.modelCount > 0 ? `, ${runtime.modelCount} model${runtime.modelCount === 1 ? "" : "s"}` : "";

  return `${chats}${active}${models}`;
}

function formatUpdateStatus(status: HostStatus["update"]) {
  const version = status.availableVersion ? ` ${sanitizeTerminalLine(status.availableVersion)}` : "";

  switch (status.state) {
    case "available":
      return `available${version}`;
    case "applying":
    case "checking":
    case "downloading":
    case "failed":
    case "idle":
    case "staged":
      return `${status.state}${version}`;
  }
}

export function readDeskCueStatus(request: HostRequest) {
  return readOptionalHostStatus(request);
}

export async function readCliStatusSnapshot(
  status: HostStatus,
  fetchImpl: typeof fetch = fetch
): Promise<CliStatusSnapshot> {
  if (!status.daemon.baseUrl || status.daemon.state !== "running") {
    throw new Error("DeskCue daemon is not running.");
  }

  const daemonUrl = assertLoopbackDaemonUrl(status.daemon.baseUrl);
  const url = new URL("/api/cli/status", daemonUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLI_STATUS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "sec-fetch-site": "same-origin"
      },
      signal: controller.signal
    });

    return parseCliStatusSnapshot(await readBoundedJson(response));
  } finally {
    clearTimeout(timeout);
  }
}

export function formatStatus(
  status: HostStatus | null,
  snapshot: CliStatusSnapshot | null = null,
  snapshotUnavailable = false,
  now = Date.now()
) {
  if (!status) {
    return "DeskCue Host: not running\nDeskCue daemon: stopped\nNext: deskcue start";
  }

  const daemonDetails = [
    status.daemon.pid ? `PID ${status.daemon.pid}` : null,
    status.daemon.version ? `version ${sanitizeTerminalLine(status.daemon.version)}` : null
  ].filter(Boolean);
  const daemonIdentity = daemonDetails.length > 0 ? ` (${daemonDetails.join(", ")})` : "";
  const daemonUrl = status.daemon.baseUrl ? ` at ${sanitizeTerminalLine(status.daemon.baseUrl)}` : "";
  const autostart = !status.autostart.supported
    ? "unsupported"
    : status.autostart.enabled === null
      ? "unknown"
      : status.autostart.enabled
        ? "enabled"
        : "disabled";

  const ready = status.host.state === "running" && status.daemon.state === "running";
  const lines = [
    `DeskCue ${sanitizeTerminalLine(status.host.version)}  ${ready ? "READY" : "NEEDS ATTENTION"}`,
    "",
    "Core",
    `  Host       ${status.host.state.padEnd(9)} PID ${status.host.pid}  started ${formatRelativeTime(status.host.startedAt, now)}`,
    `  Daemon     ${status.daemon.state.padEnd(9)}${daemonIdentity}${daemonUrl}`,
    `  Update     ${formatUpdateStatus(status.update)}`,
    `  Autostart  ${autostart}`
  ];

  if (status.daemon.lastError) lines.push(`Daemon error: ${sanitizeTerminalLine(status.daemon.lastError)}`);
  if (status.daemon.restartAttempt > 0) lines.push(`Daemon recovery attempt: ${status.daemon.restartAttempt}`);
  if (status.busyReason) lines.push(`Busy: ${sanitizeTerminalLine(status.busyReason)}`);

  if (status.update.lastError) lines.push(`Update error: ${formatUpdateError(status.update.lastError)}`);

  if (snapshot) {
    const totalSuffix = snapshot.chatCountExact ? "" : "+";
    const activeSuffix = snapshot.activeChatCountExact ? "" : "+";

    lines.push(
      "",
      "Chats",
      `  ${snapshot.chatCount}${totalSuffix} total  |  ${snapshot.activeChatCount}${activeSuffix} active`
    );

    if (snapshot.lastChat) {
      const lastChatDetails = [
        sanitizeTerminalLine(snapshot.lastChat.sourceLabel),
        snapshot.lastChat.model ? sanitizeTerminalLine(snapshot.lastChat.model) : null,
        snapshot.lastChat.workspaceName ? sanitizeTerminalLine(snapshot.lastChat.workspaceName) : null,
        formatRelativeTime(snapshot.lastChat.updatedAt, now)
      ].filter(Boolean);

      lines.push(
        "",
        "Last activity",
        `  ${sanitizeTerminalLine(snapshot.lastChat.title)}`,
        `  ${lastChatDetails.join("  |  ")}`
      );
    }

    lines.push("", "Agents and runtimes");
    for (const runtime of snapshot.runtimes) {
      lines.push(
        `  ${formatRuntimeState(runtime).padEnd(10)} ${sanitizeTerminalLine(runtime.label).padEnd(13)} ${formatRuntimeCount(runtime)}`,
        `  ${"".padEnd(10)} ${sanitizeTerminalLine(runtime.statusText)}`
      );
    }
  } else if (snapshotUnavailable) {
    lines.push("", "Activity", "  Live chat and runtime details are temporarily unavailable");
  }

  const nextSteps: string[] = [];

  if (status.daemon.state === "stopped") nextSteps.push("Run deskcue start.");
  if (status.host.state === "degraded" || status.daemon.state === "degraded") {
    nextSteps.push("Run deskcue logs --lines 100.");
  }

  if (status.update.state === "failed") {
    nextSteps.push("Check the release channel or try deskcue update --check again later.");
  }

  if (nextSteps.length > 0) lines.push("", "Next", ...nextSteps.map((step) => `  ${step}`));
  else if (ready) lines.push("", "Open dashboard: deskcue open");

  return lines.join("\n");
}
