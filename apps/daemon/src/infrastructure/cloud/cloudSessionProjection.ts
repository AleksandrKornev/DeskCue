import { createHash } from "node:crypto";

import type {
  AgentSessionSummary,
  LocalLlmChatSummary,
  SessionSummary
} from "@deskcue/protocol";
import type {
  CloudRelaySessionSummary,
  CloudResolvedSessionRoute
} from "@deskcue/protocol/cloud";

export type CloudProjectionSource = {
  listLocalLlmChats: () => Promise<LocalLlmChatSummary[]>;
  listManagedSessions: () => SessionSummary[];
  listSourceSessions: () => Promise<AgentSessionSummary[]>;
};

const CLOUD_SESSION_PROJECTION_LIMIT = 512;
const CLOUD_SESSION_DISPLAY_LABEL_MAX_CHARS = 160;
const CLOUD_SESSION_WORKSPACE_LABEL_MAX_CHARS = 80;
const CLOUD_LABEL_UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const CLOUD_SYNTHETIC_SESSION_LABEL = /^(?:codex|claude) session [a-f0-9-]{8}$/iu;

type CloudProjectionDisclosure = {
  includeLabels: boolean;
};

type CloudProjectionLabels = Pick<
  CloudRelaySessionSummary,
  "displayLabel" | "isSubagent" | "workspaceLabel"
>;

type CloudSessionProjectionEntry = {
  route: CloudResolvedSessionRoute;
  summary: CloudRelaySessionSummary;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function isSubagentSession(session: Pick<AgentSessionSummary, "source" | "subagent">) {
  if (session.subagent) return true;
  if (!isRecord(session.source)) return false;

  const subagent = session.source.subagent;

  return isRecord(subagent) && isRecord(subagent.thread_spawn);
}

function sanitizeCloudLabel(value: string | null | undefined, maxChars: number) {
  if (!value) return undefined;

  const normalized = value
    .normalize("NFKC")
    .replace(CLOUD_LABEL_UNSAFE_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return undefined;

  return [...normalized].slice(0, maxChars).join("");
}

function sanitizeCloudDisplayLabel(value: string | null | undefined) {
  const label = sanitizeCloudLabel(value, CLOUD_SESSION_DISPLAY_LABEL_MAX_CHARS);

  if (!label) return undefined;
  if (CLOUD_SYNTHETIC_SESSION_LABEL.test(label)) return undefined;
  if (!/^(?:[a-z]:[\\/]|[\\/]{1,2})/iu.test(label)) return label;

  const basename = label.split(/[\\/]/u).filter(Boolean).at(-1);

  return sanitizeCloudLabel(basename, CLOUD_SESSION_DISPLAY_LABEL_MAX_CHARS);
}

function sanitizeCloudWorkspaceLabel(value: string | null | undefined) {
  const label = sanitizeCloudLabel(value, CLOUD_SESSION_WORKSPACE_LABEL_MAX_CHARS);

  if (!label) return undefined;

  const basename = label.split(/[\\/]/u).filter(Boolean).at(-1);

  if (!basename || /^[a-z]:$/iu.test(basename)) return undefined;

  return sanitizeCloudLabel(basename, CLOUD_SESSION_WORKSPACE_LABEL_MAX_CHARS);
}

function disclosureFields(
  disclosure: CloudProjectionDisclosure,
  displayLabel?: string,
  workspaceLabel?: string
): Pick<CloudRelaySessionSummary, "disclosureScope" | "displayLabel" | "workspaceLabel"> {
  if (!disclosure.includeLabels) return { disclosureScope: "metadata_only" };

  return {
    disclosureScope: "user_opt_in",
    ...(displayLabel ? { displayLabel } : {}),
    ...(workspaceLabel ? { workspaceLabel } : {})
  };
}

function normalizeCloudTimestamp(value: string) {
  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function mapRuntime(adapterId: string): CloudRelaySessionSummary["runtime"] {
  if (adapterId === "codex") return "codex";
  if (adapterId === "claude-code") return "claude_code";
  if (adapterId === "ollama") return "ollama";
  if (adapterId === "lm-studio") return "lm_studio";

  return "generic_cli";
}

function opaqueSessionId(installationId: string, kind: string, localId: string) {
  return `sess_${createHash("sha256")
    .update(installationId)
    .update("\0")
    .update(kind)
    .update("\0")
    .update(localId)
    .digest("hex")}`;
}

function projectManagedReplyState(
  session: Pick<SessionSummary, "actionRequest" | "replyState">
): CloudRelaySessionSummary["replyState"] {
  if (session.actionRequest) return "waiting_for_user";
  if (session.replyState.phase === "idle") return "idle";

  return "waiting_for_agent";
}

function projectManagedSession(
  installationId: string,
  session: SessionSummary,
  disclosure: CloudProjectionDisclosure,
  labels: CloudProjectionLabels = {}
): CloudRelaySessionSummary | null {
  const updatedAt = normalizeCloudTimestamp(session.lastActivityAt);

  if (!updatedAt) return null;

  return {
    sessionId: session.sourceSessionId
      ? opaqueSessionId(
          installationId,
          "source",
          `${session.adapterId}:${session.sourceSessionId}`
        )
      : opaqueSessionId(installationId, "managed", session.id),
    runtime: mapRuntime(session.adapterId),
    ...(labels.isSubagent ? { isSubagent: true } : {}),
    status: session.status,
    replyState: projectManagedReplyState(session),
    updatedAt,
    ...disclosureFields(
      disclosure,
      labels.displayLabel,
      sanitizeCloudWorkspaceLabel(labels.workspaceLabel ?? session.workspaceName)
    )
  };
}

function projectSourceSession(
  installationId: string,
  session: AgentSessionSummary,
  disclosure: CloudProjectionDisclosure
): CloudRelaySessionSummary | null {
  const updatedAt = normalizeCloudTimestamp(session.updatedAt);

  if (!updatedAt) return null;

  return {
    sessionId: opaqueSessionId(
      installationId,
      "source",
      `${session.agentId}:${session.sourceSessionId}`
    ),
    runtime: mapRuntime(session.agentId),
    ...(isSubagentSession(session) ? { isSubagent: true } : {}),
    status: session.workState === "running" ? "running" : "read_only",
    replyState: session.workState === "running" ? "waiting_for_agent" : "idle",
    updatedAt,
    ...disclosureFields(
      disclosure,
      sanitizeCloudDisplayLabel(session.title),
      sanitizeCloudWorkspaceLabel(session.workspaceName)
    )
  };
}

function projectLocalChat(
  installationId: string,
  chat: LocalLlmChatSummary,
  disclosure: CloudProjectionDisclosure
): CloudRelaySessionSummary | null {
  const updatedAt = normalizeCloudTimestamp(chat.updatedAt);

  if (!updatedAt) return null;

  return {
    sessionId: opaqueSessionId(installationId, "local", chat.id),
    runtime: chat.runtimeId === "lm-studio" ? "lm_studio" : "ollama",
    status: chat.generationState === "running" || chat.generationState === "waiting_approval"
      ? "running"
      : chat.generationState === "failed"
        ? "failed"
        : chat.generationState === "interrupted" ? "stopped" : "read_only",
    replyState: chat.generationState === "running"
      ? "waiting_for_agent"
      : chat.generationState === "waiting_approval" ? "waiting_for_user" : "idle",
    updatedAt,
    ...disclosureFields(
      disclosure,
      sanitizeCloudDisplayLabel(chat.title),
      sanitizeCloudWorkspaceLabel(chat.workspace?.name)
    )
  };
}

async function readCloudSessionProjectionEntries(
  installationId: string,
  source: CloudProjectionSource,
  disclosure: CloudProjectionDisclosure = { includeLabels: false }
): Promise<CloudSessionProjectionEntry[]> {
  const [sourceSessions, localChats] = await Promise.all([
    source.listSourceSessions(),
    source.listLocalLlmChats()
  ]);
  const sourceLabels = new Map(sourceSessions.map((session) => [
    `${session.agentId}:${session.sourceSessionId}`,
    {
      displayLabel: sanitizeCloudDisplayLabel(session.title),
      isSubagent: isSubagentSession(session),
      workspaceLabel: sanitizeCloudWorkspaceLabel(session.workspaceName)
    }
  ]));
  const entries = new Map<string, CloudSessionProjectionEntry>();

  for (const session of source.listManagedSessions()) {
    const labels = session.sourceSessionId
      ? sourceLabels.get(`${session.adapterId}:${session.sourceSessionId}`)
      : undefined;
    const projection = projectManagedSession(installationId, session, disclosure, labels);

    if (projection) {
      entries.set(projection.sessionId, {
        route: { kind: "managed", sessionId: session.id },
        summary: projection
      });
    }
  }

  for (const session of sourceSessions) {
    const projection = projectSourceSession(installationId, session, disclosure);

    if (projection && !entries.has(projection.sessionId)) {
      entries.set(projection.sessionId, {
        route: { kind: "agent", sessionId: session.id },
        summary: projection
      });
    }
  }

  for (const chat of localChats) {
    const projection = projectLocalChat(installationId, chat, disclosure);

    if (projection) {
      entries.set(projection.sessionId, {
        route: { kind: "local_llm", sessionId: chat.id },
        summary: projection
      });
    }
  }

  return [...entries.values()].slice(0, CLOUD_SESSION_PROJECTION_LIMIT);
}

/** Builds the bounded session view allowed to leave the local daemon. */
export async function readCloudSessionProjection(
  installationId: string,
  source: CloudProjectionSource,
  disclosure: CloudProjectionDisclosure = { includeLabels: false }
): Promise<CloudRelaySessionSummary[]> {
  return (await readCloudSessionProjectionEntries(installationId, source, disclosure))
    .map(({ summary }) => summary);
}

/** Resolves an opaque Cloud summary to a transient, local-only DeskCue route target. */
export async function resolveCloudSessionRoute(
  installationId: string,
  source: CloudProjectionSource,
  cloudSessionId: string
): Promise<CloudResolvedSessionRoute | null> {
  const entry = (await readCloudSessionProjectionEntries(installationId, source))
    .find(({ summary }) => summary.sessionId === cloudSessionId);

  return entry?.route ?? null;
}
