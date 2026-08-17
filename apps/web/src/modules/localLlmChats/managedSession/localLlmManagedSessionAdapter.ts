import type {
  AgentSessionDetail,
  AgentTranscriptActivityGroup,
  AgentTranscriptEntry,
  AgentTranscriptViewResponse,
  LocalLlmChatChangeSet,
  LocalLlmChatDetail,
  RuntimeSummary,
  SessionDetail,
  SessionStatus
} from "@deskcue/protocol";

import {
  groupLocalLlmTurnActivities,
  localLlmInterruptedUserMessageIds,
  localLlmLatestWaitingDetailEntry,
  localLlmWaitingPrompt
} from "./localLlmManagedSessionTranscript";

const EMPTY_GIT = {
  branch: null,
  changedFiles: [],
  diff: "",
  isGitRepo: false,
  isDirty: false
};

export type LocalLlmManagedSessionAdapter = ReturnType<typeof buildLocalSessionAdapter>;

export function hasMoreLocalLlmHistory(detail: LocalLlmChatDetail) {
  return detail.history.messages.hasMore || detail.history.events.hasMore || detail.history.changeSets.hasMore;
}

export function toLocalLlmTranscript(detail: LocalLlmChatDetail): AgentTranscriptEntry[] {
  const entries: AgentTranscriptEntry[] = [
    ...detail.messages.filter((message) =>
      message.role !== "assistant" || Boolean(message.text.trim())
    ).map((message) => ({
      id: `local-llm:${message.id}`,
      parts: [{ text: message.text, type: "markdown" as const }],
      phase: message.status,
      role: message.role,
      text: message.text,
      timestamp: message.timestamp
    })),
    ...detail.changeSets.map((changeSet) => ({
      id: `local-llm:changes:${changeSet.id}`,
      parts: changeSet.diff ? [{
        additions: undefined,
        changeType: "unknown" as const,
        deletions: undefined,
        filePath: null,
        text: changeSet.diff,
        title: changeSet.attribution === "applied_by_deskcue_local_agent"
          ? "Changes applied by the DeskCue local agent"
          : "Workspace changes observed during this local-model turn",
        type: "diff" as const
      }] : [{
        detail: "Open the Changes item in Chat or Activity to load this patch",
        label: "Diff available",
        type: "status" as const
      }],
      phase: "complete" as const,
      role: "system" as const,
      text: `Changes: ${changeSet.changedFiles.join(", ")}`,
      timestamp: changeSet.timestamp
    }))
  ];

  return entries;
}

function changeActivityFor(changeSet: LocalLlmChatChangeSet): AgentTranscriptActivityGroup {
  const applied = changeSet.attribution === "applied_by_deskcue_local_agent";
  const title = applied
    ? "Changes applied by the DeskCue local agent"
    : "Workspace changes observed during this local-model turn";
  const entry: AgentTranscriptEntry = {
    id: `local-llm:changes:${changeSet.id}`,
    parts: changeSet.diff ? [{
      additions: undefined,
      changeType: "unknown",
      deletions: undefined,
      filePath: null,
      text: changeSet.diff,
      title,
      type: "diff"
    }] : [{
      detail: "Open this block to load the compressed patch from local storage",
      label: "Diff available",
      type: "status"
    }],
    phase: "complete",
    role: "system",
    text: `${applied ? "Changes applied by DeskCue in this turn" : "Workspace changes observed during this turn"}: ${changeSet.changedFiles.join(", ")}`,
    timestamp: changeSet.timestamp
  };
  return {
    entries: [entry],
    entryIds: [entry.id],
    id: entry.id,
    kind: "changes",
    label: changeSet.changedFiles.length === 1 ? "Changes (1)" : `Changes (${changeSet.changedFiles.length})`,
    sourceEntryIds: [entry.id],
    timestamp: changeSet.timestamp
  };
}

function turnStatusFor(entry: AgentTranscriptEntry, interruptedUserMessageIds: ReadonlySet<string>) {
  if (entry.role === "user" && interruptedUserMessageIds.has(entry.id.replace(/^local-llm:/, ""))) {
    return {
      kind: "interrupted" as const,
      label: "Interrupted",
      title: "This prompt was interrupted before the local model returned a final assistant reply"
    };
  }

  if (entry.phase === "interrupted") {
    return {
      kind: "interrupted" as const,
      label: "Stopped",
      title: "Generation was stopped"
    };
  }

  if (entry.phase === "interrupted_after_restart") {
    return {
      kind: "incomplete" as const,
      label: "Interrupted after daemon restart",
      title: "The daemon restarted before this response completed"
    };
  }

  return null;
}

function localLlmDebugText(event: LocalLlmChatDetail["events"][number]) {
  switch (event.type) {
    case "turn_started": return "Local model generation started";
    case "assistant_message_saved": return "Assistant response saved";
    case "turn_completed": return "Local model generation completed";
    case "turn_failed": return `Local model generation failed${event.error ? `: ${event.error}` : ""}`;
    case "turn_interrupted": return "Local model generation interrupted";
    case "turn_interrupted_after_restart": return "Local model generation interrupted after daemon restart";
    case "model_reasoning_saved": return `Runtime exposed reasoning saved${event.summary ? ` (${event.summary.length} characters)` : ""}`;
    case "tool_requested": return `Tool requested: ${event.toolName ?? "unknown"}${event.summary ? ` — ${event.summary}` : ""}`;
    case "tool_completed": return `Tool completed: ${event.toolName ?? "unknown"}${event.summary ? ` — ${event.summary}` : ""}`;
    case "tool_failed": return `Tool failed: ${event.toolName ?? "unknown"}${event.error ? ` — ${event.error}` : ""}`;
    case "action_requested": return `Approval requested: ${event.actionRequest?.summary ?? event.summary ?? "local agent action"}`;
    case "action_resolved": return `Approval resolved${event.summary ? `: ${event.summary}` : ""}`;
  }
}

function localLlmDebugLogs(detail: LocalLlmChatDetail): SessionDetail["logs"] {
  const logs = detail.events.map((event) => ({
    id: `local-llm:event:${event.id}`,
    stream: event.type === "turn_failed" || event.type === "tool_failed" ? "stderr" as const : "system" as const,
    text: localLlmDebugText(event),
    timestamp: event.timestamp
  }));
  if (detail.generationError) {
    logs.push({
      id: `local-llm:generation-error:${detail.updatedAt}`,
      stream: "stderr",
      text: `Generation failed: ${detail.generationError}`,
      timestamp: detail.updatedAt
    });
  }
  return logs;
}

export function buildLocalSessionAdapter(detail: LocalLlmChatDetail, runtime: RuntimeSummary | null) {
  const runtimeLabel = runtime?.label ?? (detail.runtimeId === "lm-studio" ? "LM Studio" : "Ollama");
  const sourceSessionId = `local-llm:${detail.id}`;
  const managedSessionId = `local-llm-session:${detail.id}`;
  const isRunning = detail.generationState === "running" || detail.generationState === "waiting_approval";
  const sessionStatus: SessionStatus = isRunning ? "running" : "read_only";
  const turnPhase = isRunning
    ? "active"
    : detail.generationState === "failed"
      ? "failed"
      : detail.generationState === "interrupted"
        ? "interrupted"
        : "completed";
  const transcript = toLocalLlmTranscript(detail);
  const interruptedUserMessageIds = localLlmInterruptedUserMessageIds(detail.events);
  const waitingPrompt = localLlmWaitingPrompt(detail);
  const agentSession: AgentSessionDetail = {
    agentId: "other",
    agentLabel: runtimeLabel,
    attachMode: "resume",
    attachModeReason: "DeskCue-owned local model chat",
    cliVersion: null,
    contextCompactionCount: 0,
    filePath: `.deskcue-data/deskcue-chats/${detail.id}/chat.json`,
    id: sourceSessionId,
    model: detail.model,
    originator: null,
    source: "deskcue-owned",
    sourceSessionId,
    title: detail.headerTitle ?? detail.title,
    transcript,
    updatedAt: detail.updatedAt,
    workState: isRunning ? "running" : "idle",
    workspaceName: detail.workspace?.name ?? "No workspace linked",
    workspacePath: detail.workspace?.path ?? "No workspace linked",
    turnState: {
      activityAt: detail.updatedAt,
      completedAt: isRunning ? null : detail.updatedAt,
      evidence: "turn_lifecycle",
      fingerprint: `local-llm:${detail.id}:${detail.updatedAt}`,
      phase: turnPhase,
      startedAt: isRunning ? detail.updatedAt : null
    }
  };
  const assistantMessageTurnIds = new Map(
    detail.events
      .filter((event) => event.type === "assistant_message_saved" && event.messageId)
      .map((event) => [event.messageId!, event.turnId])
  );
  const turnActivities = groupLocalLlmTurnActivities(detail.events);
  const changesByTurn = new Map<string, AgentTranscriptActivityGroup[]>();
  for (const changeSet of detail.changeSets) {
    const changes = changesByTurn.get(changeSet.turnId) ?? [];
    changes.push(changeActivityFor(changeSet));
    changesByTurn.set(changeSet.turnId, changes);
  }
  const messageItems = transcript.map((entry) => {
    const messageId = entry.id.replace(/^local-llm:/, "");
    const turnId = entry.role === "assistant" ? assistantMessageTurnIds.get(messageId) : undefined;
    return {
      activities: turnId ? turnActivities.byTurnId.get(turnId) ?? [] : [],
      changeActivities: turnId ? changesByTurn.get(turnId) ?? [] : [],
      entry,
      key: entry.id,
      role: entry.role as "user" | "assistant",
      timestamp: entry.timestamp,
      turnStatus: turnStatusFor(entry, interruptedUserMessageIds),
      type: "message" as const
    };
  });
  const assistantTurnIds = new Set(assistantMessageTurnIds.values());
  const lifecycleItems = [
    ...turnActivities.unanchored,
    ...[...turnActivities.byTurnId.entries()]
      .filter(([turnId]) => !assistantTurnIds.has(turnId))
      .flatMap(([, activities]) => activities)
  ].map((activity) => ({
    activity,
    key: activity.id,
    type: "activity" as const
  }));
  const changeItems = detail.changeSets
    .filter((changeSet) => !assistantTurnIds.has(changeSet.turnId))
    .map((changeSet) => ({
      activity: changeActivityFor(changeSet),
      key: `local-llm:changes:${changeSet.id}`,
      type: "activity" as const
    }));
  const transcriptView: AgentTranscriptViewResponse = {
    items: [...messageItems, ...lifecycleItems, ...changeItems].sort((left, right) => {
      const leftTimestamp = left.type === "message" ? left.timestamp : left.activity.timestamp;
      const rightTimestamp = right.type === "message" ? right.timestamp : right.activity.timestamp;
      return Date.parse(leftTimestamp) - Date.parse(rightTimestamp);
    }),
    latestWaitingDetailEntry: localLlmLatestWaitingDetailEntry(detail),
    session: agentSession,
    sessionId: agentSession.id,
    updatedAt: detail.updatedAt
  };
  agentSession.transcriptView = transcriptView;

  const session: SessionDetail = {
    adapterId: detail.runtimeId,
    canSendInput: true,
    command: `${runtimeLabel} local chat`,
    exitCode: null,
    finishedAt: isRunning ? null : detail.updatedAt,
    git: detail.git ?? {
      ...EMPTY_GIT,
      lastUpdatedAt: detail.updatedAt
    },
    id: managedSessionId,
    inputBlockedReason: null,
    inputHistory: [],
    lastActivityAt: detail.updatedAt,
    logs: localLlmDebugLogs(detail),
    preview: {
      active: detail.preview?.active ?? false,
      artifacts: detail.preview?.artifacts ?? [],
      networkMode: detail.preview?.networkMode ?? "device-direct",
      port: detail.preview?.port ?? null,
      targetUrl: detail.preview?.targetUrl ?? null
    },
    replyState: {
      phase: waitingPrompt ? "waiting" : "idle",
      promptText: waitingPrompt?.text ?? null,
      requestedAt: waitingPrompt?.requestedAt ?? null
    },
    sourceSessionFilePath: agentSession.filePath,
    sourceSessionId,
    startedAt: detail.createdAt,
    status: sessionStatus,
    viewerCount: 0,
    workspaceId: detail.workspace?.id ?? `local-runtime:${detail.runtimeId}`,
    workspaceName: detail.workspace?.name ?? "No workspace linked"
  };

  return { agentSession, detail, session };
}
