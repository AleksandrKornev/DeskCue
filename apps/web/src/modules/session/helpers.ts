import type { PendingChatPrompt } from "@models/promptDelivery";

import type { ManagedSessionPanelProps } from "./types";

export async function stopExternalClaudeBackground(
  onInterruptPrompt: ManagedSessionPanelProps["onInterruptPrompt"],
  refreshCapability: () => void
) {
  await onInterruptPrompt();
  refreshCapability();
}

export function compareSwitchableManagedSessions(
  left: { id: string; startedAt: string },
  right: { id: string; startedAt: string }
) {
  const startedDelta = new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime();

  return startedDelta || left.id.localeCompare(right.id);
}

export function isRunningSourceSessionPrompt(
  session: { sourceSessionId?: string | null; status?: string } | null | undefined
) {
  return Boolean(session?.sourceSessionId) && session?.status === "running";
}

export function isLocalAgentStartupVisible(
  session: { logs?: { timestamp: string; text: string }[] } | null | undefined,
  requestedAt: string
) {
  const requestedAtTime = new Date(requestedAt).getTime();

  if (Number.isNaN(requestedAtTime)) return false;

  return (session?.logs ?? []).some((log) => {
    const logTime = new Date(log.timestamp).getTime();

    if (Number.isNaN(logTime) || logTime < requestedAtTime - 5_000) return false;

    return log.text.includes("Starting MCP") || log.text.includes("MCP servers");
  });
}

export function isPendingPromptForSession(
  prompt: PendingChatPrompt | null,
  selectedSessionId: string,
  selectedSourceSessionId: string | null
) {
  if (!prompt) return false;
  if (prompt.sessionId) return prompt.sessionId === selectedSessionId;
  if (prompt.sourceSessionId) return prompt.sourceSessionId === selectedSourceSessionId;

  return true;
}

export function hasPendingPromptSourceSessionId(prompt: unknown) {
  return (
    prompt !== null &&
    typeof prompt === "object" &&
    "sourceSessionId" in prompt &&
    Boolean((prompt as { sourceSessionId?: string | null }).sourceSessionId)
  );
}

function isTerminalTurnEntry(entry: {
  role: string;
  text: string;
  parts?: Array<{ type: string; label?: string }>;
}) {
  if (entry.role !== "system") return false;

  const statusPart = entry.parts?.find((part) => part.type === "status");
  const label = statusPart?.label ?? entry.text;

  return label === "Turn completed" || label === "Turn interrupted";
}

export function findLatestUnansweredUserPrompt(
  transcript: Array<{
    role: string;
    text: string;
    timestamp: string;
    parts?: Array<{ type: string; label?: string }>;
  }>
): PendingChatPrompt | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];

    if (entry.role !== "user") continue;

    const hasCompletionAfterPrompt = transcript
      .slice(index + 1)
      .some((candidate) => candidate.role === "assistant" || isTerminalTurnEntry(candidate));
    if (hasCompletionAfterPrompt) return null;

    const text = entry.text.trim();

    return text
      ? {
          text,
          requestedAt: entry.timestamp,
          status: "waiting"
        }
      : null;
  }

  return null;
}
