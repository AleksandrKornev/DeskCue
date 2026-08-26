import type {
  AgentTranscriptActivityGroup,
  AgentTranscriptEntry,
  LocalLlmChatEvent
} from "@deskcue/protocol";

export type LocalLlmTurnActivities = {
  byTurnId: Map<string, AgentTranscriptActivityGroup[]>;
  unanchored: AgentTranscriptActivityGroup[];
};

export function isToolEvent(event: LocalLlmChatEvent) {
  return event.type === "tool_requested" || event.type === "tool_completed" || event.type === "tool_failed";
}

function withoutTerminalPeriod(text: string) {
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

export function lifecycleDetailText(event: LocalLlmChatEvent) {
  switch (event.type) {
    case "turn_started": return "DeskCue started local model generation";
    case "assistant_message_saved": return "DeskCue saved the assistant response";
    case "turn_completed": return "Local model generation completed";
    case "turn_failed":
      return event.error
        ? `Local model generation failed: ${withoutTerminalPeriod(event.error)}`
        : "Local model generation failed";
    case "turn_interrupted": return "Local model generation was stopped";
    case "turn_interrupted_after_restart": return "DeskCue restarted before local model generation finished";
    case "model_reasoning_saved": return event.summary ?? "Local model exposed reasoning";
    case "tool_requested": return event.toolName ? `Local agent requested ${event.toolName}` : "Local agent requested a tool";
    case "tool_completed":
      return event.summary
        ? withoutTerminalPeriod(event.summary)
        : event.toolName ? `Local agent completed ${event.toolName}` : "Local agent completed a tool";
    case "tool_failed":
      return event.error
        ? withoutTerminalPeriod(event.error)
        : event.toolName ? `Local agent could not complete ${event.toolName}` : "Local agent tool failed";
    case "action_requested":
      return event.actionRequest?.summary
        ? withoutTerminalPeriod(event.actionRequest.summary)
        : "Local agent needs approval before continuing";
    case "action_resolved":
      return event.summary ? withoutTerminalPeriod(event.summary) : "Local agent action request was resolved";
  }
}

function toolActivitiesForTurn(turnId: string, events: readonly LocalLlmChatEvent[]): AgentTranscriptActivityGroup[] {
  const eventsByToolCall = new Map<string, LocalLlmChatEvent[]>();

  for (const event of events) {
    if (!isToolEvent(event)) continue;

    const toolCallId = event.toolCallId ?? event.id;
    const toolEvents = eventsByToolCall.get(toolCallId) ?? [];

    toolEvents.push(event);

    eventsByToolCall.set(toolCallId, toolEvents);
  }

  if (!eventsByToolCall.size) return [];

  const entries: AgentTranscriptEntry[] = [...eventsByToolCall.values()].map((toolEvents) => {
    const terminal = [...toolEvents].reverse().find((event) => event.type !== "tool_requested");
    const event = terminal ?? toolEvents[0];
    const text = terminal ? lifecycleDetailText(terminal) : lifecycleDetailText(event);

    return {
      id: `local-llm:tool:${turnId}:${event.toolCallId ?? event.id}`,
      parts: [{ text, type: "markdown" }],
      phase: "commentary",
      role: "commentary",
      text,
      timestamp: event.timestamp
    };
  });
  const latestTimestamp = entries.reduce(
    (latest, entry) => latest > entry.timestamp ? latest : entry.timestamp,
    entries[0].timestamp
  );

  return [{
    entries,
    entryIds: entries.map((entry) => entry.id),
    id: `local-llm:tools:${turnId}`,
    kind: "tools",
    label: `Tools (${entries.length})`,
    sourceEntryIds: entries.map((entry) => entry.id),
    timestamp: latestTimestamp
  }];
}

function detailActivitiesForTurn(turnId: string, events: readonly LocalLlmChatEvent[]): AgentTranscriptActivityGroup[] {
  const visible = events.filter((event) =>
    event.type === "turn_failed" ||
    event.type === "turn_interrupted" ||
    event.type === "turn_interrupted_after_restart" ||
    event.type === "model_reasoning_saved" ||
    event.type === "action_requested" ||
    event.type === "action_resolved"
  );

  if (!visible.length) return [];

  const entries: AgentTranscriptEntry[] = visible.map((event) => {
    const text = lifecycleDetailText(event);

    return {
      id: `local-llm:detail:${event.id}`,
      parts: [{ text, type: "markdown" }],
      phase: "commentary",
      role: "commentary",
      text,
      timestamp: event.timestamp
    };
  });

  return [{
    entries,
    entryIds: entries.map((entry) => entry.id),
    id: `local-llm:details:${turnId}`,
    kind: "details",
    label: `Details (${entries.length})`,
    sourceEntryIds: entries.map((entry) => entry.id),
    timestamp: entries.at(-1)!.timestamp
  }];
}

/** Collapse granular ledger events into the durable activity groups rendered by the chat timeline. */
export function groupLocalLlmTurnActivities(events: readonly LocalLlmChatEvent[]): LocalLlmTurnActivities {
  const byTurnId = new Map<string, AgentTranscriptActivityGroup[]>();
  const unanchored: AgentTranscriptActivityGroup[] = [];
  const eventsByTurn = new Map<string, LocalLlmChatEvent[]>();

  for (const event of events) {
    const turnEvents = eventsByTurn.get(event.turnId) ?? [];

    turnEvents.push(event);

    eventsByTurn.set(event.turnId, turnEvents);
  }

  for (const [turnId, turnEvents] of eventsByTurn) {
    const groups = [
      ...toolActivitiesForTurn(turnId, turnEvents),
      ...detailActivitiesForTurn(turnId, turnEvents)
    ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));

    if (groups.length) byTurnId.set(turnId, groups);
  }

  return { byTurnId, unanchored };
}
