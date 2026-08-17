import type { SessionActionRequest } from "@deskcue/protocol";

const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

function isApprovalPromptLog(text: string) {
  return text.includes("Would you like to run the following command?") &&
    text.includes("Yes, proceed") &&
    text.includes("No, and tell");
}

function isApprovalCompletionLog(text: string) {
  return text.includes("You approved codex to run") ||
    text.includes("You denied codex to run") ||
    text.includes("Operation cancelled by user");
}

function extractCommand(text: string) {
  const match = text.match(/^\s*\$\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function isApprovalPromptSectionStart(line: string) {
  return line.startsWith("$ ") ||
    /^\d+\.\s/.test(line) ||
    line.startsWith("Environment:") ||
    line.startsWith("Would you like to run the following command?");
}

function extractReason(text: string) {
  const lines = text.split("\n");
  const reasonLineIndex = lines.findIndex((line) => line.includes("Reason:"));
  if (reasonLineIndex === -1) {
    return null;
  }

  const parts: string[] = [];
  const firstLine = lines[reasonLineIndex] ?? "";
  parts.push(firstLine.slice(firstLine.indexOf("Reason:") + "Reason:".length).trim());

  for (const line of lines.slice(reasonLineIndex + 1)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || isApprovalPromptSectionStart(trimmedLine)) {
      break;
    }
    parts.push(trimmedLine);
  }

  return parts.filter(Boolean).join(" ") || null;
}

function isSameOrPartialReason(current: string | null, next: string | null) {
  if (!current || !next) {
    return current === next || !next;
  }

  return current === next || current.startsWith(next);
}

function normalizeLogText(text: string) {
  return text
    .replace(ANSI_PATTERN, "")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n");
}

export function deriveActionRequestFromLog(input: {
  current: SessionActionRequest | null;
  text: string;
  timestamp: string;
}): SessionActionRequest | null | undefined {
  const normalizedText = normalizeLogText(input.text);

  if (isApprovalCompletionLog(normalizedText)) {
    return null;
  }

  if (!isApprovalPromptLog(normalizedText)) {
    return undefined;
  }

  const command = extractCommand(normalizedText);
  const reason = extractReason(normalizedText);

  if (
    input.current?.kind === "approval" &&
    input.current.command === command &&
    isSameOrPartialReason(input.current.reason, reason)
  ) {
    return input.current;
  }

  if (
    input.current?.kind === "approval" &&
    input.current.command === command &&
    input.current.reason === reason
  ) {
    return input.current;
  }

  return {
    command,
    kind: "approval",
    reason,
    requestedAt: input.timestamp
  };
}

export function isApprovalDecisionInput(input: string) {
  const normalized = input.trim().toLowerCase();
  return normalized === "y" || normalized === "yes" || normalized === "approve" ||
    normalized === "n" || normalized === "no" || normalized === "reject" ||
    normalized === "esc" || normalized === "escape";
}

export function toApprovalDecisionKey(input: string) {
  const normalized = input.trim().toLowerCase();
  if (normalized === "n" || normalized === "no" || normalized === "reject" ||
    normalized === "esc" || normalized === "escape") {
    return "\x1b";
  }

  return "y";
}
