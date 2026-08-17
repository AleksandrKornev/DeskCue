import type { NotificationPayload } from "../state/notificationTypes.ts";

function formatTelegramStatusLine(status: string, duration: string | null) {
  return duration ? `${status} - ${duration}` : status;
}

function formatTelegramPreview(value: string, maxLength: number) {
  const normalized = value.replace(/\r\n/g, "\n").split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, "")).filter(Boolean).join(" ")
    .replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return { text: normalized, truncated: false };
  const candidate = normalized.slice(0, maxLength + 1);
  const sentenceBoundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("! "), candidate.lastIndexOf("? "));
  const wordBoundary = candidate.lastIndexOf(" ");
  const cutAt = sentenceBoundary >= 80 ? sentenceBoundary + 1 : wordBoundary >= 80 ? wordBoundary : maxLength;
  return { text: `${candidate.slice(0, cutAt).trim()}...`, truncated: true };
}

function formatTelegramBlock(label: string, value: string | null, maxLength: number) {
  return value ? `${label}\n${formatTelegramPreview(value, maxLength).text}` : null;
}

function formatTelegramAnswer(answer: string | null) {
  if (!answer) return null;
  const preview = formatTelegramPreview(answer, 260);
  return { text: `Answer\n${preview.text}`, truncated: preview.truncated };
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function readStringData(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumberData(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatTelegramDuration(data: Record<string, unknown> | undefined) {
  const durationMs = readNumberData(data, "durationMs");
  if (typeof durationMs === "number") return formatDuration(durationMs);
  const startedAt = readStringData(data, "startedAt");
  const completedAt = readStringData(data, "completedAt");
  if (!startedAt || !completedAt) return null;
  const startedTime = Date.parse(startedAt);
  const completedTime = Date.parse(completedAt);
  if (Number.isNaN(startedTime) || Number.isNaN(completedTime) || completedTime < startedTime) return null;
  return formatDuration(completedTime - startedTime);
}

export function formatAgentLabel(adapterId: string) {
  if (adapterId === "codex") return "Codex";
  if (adapterId === "claude-code") return "Claude Code";
  return "Agent";
}

export function formatExitCode(exitCode: number | null) {
  return typeof exitCode === "number" ? `, exit code ${exitCode}` : "";
}

export function truncateForPush(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function formatTelegramField(label: string, value: string | null) {
  return value ? `${label}: ${truncateForPush(value, 500)}` : null;
}

function isAbsoluteHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function formatExternalNotificationMessage(payload: NotificationPayload) {
  const url = payload.url.trim();
  return isAbsoluteHttpUrl(url) ? `${payload.body}\n\n${url}` : payload.body;
}

function isByteString(value: string) {
  return /^[\u0000-\u00ff]*$/.test(value);
}

export function formatNtfyHeaderValue(value: string) {
  return isByteString(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function escapeTelegramMarkdown(value: string) {
  return value.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function formatTelegramLines(lines: Array<string | null>) {
  const normalizedLines = lines.filter((line): line is string => line !== null);
  while (normalizedLines.length > 0 && !normalizedLines.at(-1)?.trim()) normalizedLines.pop();
  return normalizedLines
    .map((line) => line.startsWith("*") && line.endsWith("*")
      ? `*${escapeTelegramMarkdown(line.slice(1, -1))}*`
      : escapeTelegramMarkdown(line))
    .join("\n");
}

export function formatTelegramNotification(payload: NotificationPayload) {
  const kind = readStringData(payload.data, "notificationKind");
  if (kind === "agent.turn.finished") {
    const agentLabel = readStringData(payload.data, "agentLabel") ?? "Agent";
    const duration = formatTelegramDuration(payload.data);
    const answer = formatTelegramAnswer(readStringData(payload.data, "answer"));
    return formatTelegramLines([
      `*${payload.title}*`,
      readStringData(payload.data, "status") === "interrupted"
        ? formatTelegramStatusLine(`${agentLabel} stopped before finishing`, duration)
        : formatTelegramStatusLine(`${agentLabel} finished the task`, duration),
      answer ? "" : null,
      answer?.text ?? null,
      answer?.truncated ? "" : null,
      answer?.truncated ? "Full answer is available in DeskCue." : null
    ]);
  }
  if (kind === "approval.required") {
    return formatTelegramLines([
      `*${payload.title}*`,
      `${readStringData(payload.data, "agentLabel") ?? "Agent"} needs approval`,
      "",
      formatTelegramBlock("Reason", readStringData(payload.data, "reason"), 500),
      "",
      formatTelegramField("Workspace", readStringData(payload.data, "workspaceName"))
    ]);
  }
  return formatTelegramLines([`*${payload.title}*`, payload.body]);
}
