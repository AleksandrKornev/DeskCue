import { codexAdapter, getAdapterMetadata } from "@deskcue/adapters";
import type {
  AgentSessionDetail,
  AgentSessionSourceVersion,
  AgentSessionSummary,
  AgentTranscriptEntry,
  CodexSessionDetail,
  CodexSessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import { getCodexAttachState } from "#agents/codex/session/codexReplyState";
import type { SourceAgentTurnState } from "#agents/sourceAgentTurnState";

import {
  getClaudeSessionDetail,
  getClaudeSessionVersion,
  listClaudeSessions
} from "./claude/discovery/claudeDiscovery.ts";
import {
  getClaudeTranscriptEntries,
  getClaudeTranscriptPreviousWindow,
  getClaudeTranscriptTailWindow,
  getClaudeTranscriptWindow
} from "./claude/transcript/claudeTranscriptHydration.ts";
import {
  getCodexSessionDetail,
  getCodexSessionVersion,
  getCodexTranscriptEntries,
  getCodexTranscriptPreviousWindow,
  getCodexTranscriptTailWindow,
  getCodexTranscriptWindow,
  listCodexSessions,
  readCodexSessionDetailReadMode
} from "./codex/codexFacade.ts";
import { markSourceAgentDetailMetadata } from "./sourceAgentDetailMetadata.ts";

export interface SourceAgentListContext {
  force: boolean;
  includeLiveMetadata: boolean;
  limit: number;
  workspaces: WorkspaceSummary[];
}

export type SourceAgentLightweightMode = boolean | "exact-ids" | "bounded-exact-ids";

export interface SourceAgentDetailContext {
  force: boolean;
  chatMessageTail?: number;
  lightweight?: SourceAgentLightweightMode;
  transcriptTail?: number;
}

export interface SourceAgentTranscriptCapability {
  getEntries?(
    sourceSessionId: string,
    entryIds: string[],
    context: Pick<SourceAgentDetailContext, "force">
  ): Promise<AgentTranscriptEntry[]>;
  getWindow?(
    sourceSessionId: string,
    context: Pick<SourceAgentDetailContext, "force"> & {
      baseSourceEntryId: string;
      maxLineCount?: number;
      overlapLineCount?: number;
    }
  ): Promise<AgentTranscriptEntry[] | null>;
  getTailWindow?(
    sourceSessionId: string,
    context: Pick<SourceAgentDetailContext, "force" | "chatMessageTail">
  ): Promise<AgentTranscriptEntry[] | null>;
  getPreviousWindow?(
    sourceSessionId: string,
    context: Pick<SourceAgentDetailContext, "force"> & {
      beforeEntryId: string;
    }
  ): Promise<{ entries: AgentTranscriptEntry[]; hasMore: boolean } | null>;
}

export interface SourceAgentDescriptor {
  adapterId: AgentSessionSummary["agentId"];
  listSessions(context: SourceAgentListContext): Promise<AgentSessionSummary[]>;
  getSessionDetail(
    sourceSessionId: string,
    context: SourceAgentDetailContext
  ): Promise<AgentSessionDetail | null>;
  getSessionVersion?(
    sourceSessionId: string,
    context: Pick<SourceAgentDetailContext, "force">
  ): Promise<AgentSessionSourceVersion | null>;
  transcript?: SourceAgentTranscriptCapability;
}

const CODEX_LIST_ATTACH_TRANSCRIPT_TAIL = 80;
const CODEX_LIST_ATTACH_STATE_LIMIT = 8;

export function buildAgentSessionId(agentId: string, sourceSessionId: string) {
  return `${agentId}:${sourceSessionId}`;
}

export function parseAgentSessionId(agentSessionId: string) {
  const separator = agentSessionId.indexOf(":");

  if (separator <= 0) return null;

  return {
    agentId: agentSessionId.slice(0, separator),
    sourceSessionId: agentSessionId.slice(separator + 1)
  };
}

function getAgentLabel(adapterId: string) {
  return getAdapterMetadata(adapterId)?.label ?? adapterId;
}

function toAgentSessionWorkState(turnState: SourceAgentTurnState) {
  return turnState.phase === "active" ? "running" : "idle";
}

function toAgentSessionObservedTurnState(turnState: SourceAgentTurnState) {
  if (turnState.phase === "active") {
    return {
      activityAt: turnState.activityAt,
      completedAt: null,
      evidence: turnState.evidence,
      fingerprint: turnState.fingerprint,
      phase: turnState.phase,
      startedAt: turnState.startedAt
    };
  }

  if (turnState.phase === "idle") {
    return {
      activityAt: null,
      completedAt: null,
      evidence: turnState.evidence,
      fingerprint: turnState.fingerprint,
      phase: turnState.phase,
      startedAt: null
    };
  }

  return {
    activityAt: null,
    completedAt: turnState.completedAt,
    evidence: turnState.evidence,
    fingerprint: turnState.fingerprint,
    phase: turnState.phase,
    startedAt: null,
    turnStartFingerprint: turnState.turnStartFingerprint
  };
}

export function toCodexAgentSessionSummary(
  session: CodexSessionSummary,
  attachState: ReturnType<typeof getCodexAttachState> = {
    mode: "resume",
    reason: null,
    turnState: {
      evidence: "none",
      fingerprint: null,
      phase: "idle"
    }
  }
): AgentSessionSummary {
  return {
    id: buildAgentSessionId(codexAdapter.id, session.id),
    agentId: "codex",
    agentLabel: getAgentLabel(codexAdapter.id),
    sourceSessionId: session.id,
    title: session.threadName,
    workspacePath: session.workspacePath,
    workspaceName: session.workspaceName,
    updatedAt: session.updatedAt,
    model: session.model,
    originator: session.originator,
    cliVersion: session.cliVersion,
    source: session.source,
    filePath: session.filePath,
    contextCompactionCount: session.contextCompactionCount,
    approvalPolicy: session.approvalPolicy,
    sandboxMode: session.sandboxMode,
    attachMode: attachState.mode,
    attachModeReason: attachState.reason,
    workState: toAgentSessionWorkState(attachState.turnState),
    turnState: toAgentSessionObservedTurnState(attachState.turnState)
  };
}

function toCodexAgentSessionDetail(session: CodexSessionDetail): AgentSessionDetail {
  const attachState = getCodexAttachState(session.transcript);

  const detail = {
    ...toCodexAgentSessionSummary(session, attachState),
    attachMode: attachState.mode,
    attachModeReason: attachState.reason,
    transcript: session.transcript
  };

  const readMode = readCodexSessionDetailReadMode(session);

  if (readMode) markSourceAgentDetailMetadata(detail, { readMode });

  return detail;
}

export const sourceAgentDescriptors: SourceAgentDescriptor[] = [
  {
    adapterId: "codex",
    async listSessions({ force, includeLiveMetadata, limit }) {
      const sessions = await listCodexSessions(limit, force);

      if (!includeLiveMetadata) {
        return sessions.map((session) => toCodexAgentSessionSummary(session));
      }

      return Promise.all(
        sessions.map(async (session, index) => {
          if (index >= CODEX_LIST_ATTACH_STATE_LIMIT) return toCodexAgentSessionSummary(session);

          const detail = await getCodexSessionDetail(
            session.id,
            force,
            CODEX_LIST_ATTACH_TRANSCRIPT_TAIL,
            undefined,
            {
              includeContextCompactionCount: false,
              lineIndexOffset: "tail-relative",
              readExpandedTailWhenMissingUser: false
            }
          );

          return toCodexAgentSessionSummary(
            session,
            detail ? getCodexAttachState(detail.transcript) : undefined
          );
        })
      );
    },
    async getSessionDetail(sourceSessionId, { force, chatMessageTail, lightweight, transcriptTail }) {
      const shouldUseLightweightPayload = Boolean(lightweight);
      const shouldUseTailRelativeIds = lightweight === true;
      const session = await getCodexSessionDetail(
        sourceSessionId,
        force,
        transcriptTail,
        chatMessageTail,
        {
          includeContextCompactionCount: !shouldUseLightweightPayload,
          lineIndexOffset: shouldUseTailRelativeIds ? "tail-relative" : "exact",
          preferBoundedTail: lightweight === "bounded-exact-ids",
          readExpandedTailWhenMissingUser: !shouldUseLightweightPayload
        }
      );

      return session ? toCodexAgentSessionDetail(session) : null;
    },
    async getSessionVersion(sourceSessionId, { force }) {
      const version = await getCodexSessionVersion(sourceSessionId, force);

      return version
        ? {
            ...version,
            summary: toCodexAgentSessionSummary(version.summary)
          }
        : null;
    },
    transcript: {
      getEntries(sourceSessionId, entryIds, { force }) {
        return getCodexTranscriptEntries(sourceSessionId, entryIds, force);
      },
      getWindow(sourceSessionId, { baseSourceEntryId, force, maxLineCount, overlapLineCount }) {
        return getCodexTranscriptWindow(sourceSessionId, baseSourceEntryId, {
          force,
          maxLineCount,
          overlapLineCount
        });
      },
      getTailWindow(sourceSessionId, { chatMessageTail, force }) {
        return getCodexTranscriptTailWindow(sourceSessionId, {
          chatMessageTail,
          force
        });
      },
      getPreviousWindow(sourceSessionId, { beforeEntryId, force }) {
        return getCodexTranscriptPreviousWindow(sourceSessionId, beforeEntryId, { force });
      }
    }
  },
  {
    adapterId: "claude-code",
    listSessions({ force, limit }) {
      return listClaudeSessions(limit, force);
    },
    getSessionDetail(sourceSessionId, { chatMessageTail, force, transcriptTail }) {
      return getClaudeSessionDetail(sourceSessionId, force, transcriptTail, chatMessageTail);
    },
    getSessionVersion(sourceSessionId, { force }) {
      return getClaudeSessionVersion(sourceSessionId, force);
    },
    transcript: {
      getEntries(sourceSessionId, entryIds, { force }) {
        return getClaudeTranscriptEntries(sourceSessionId, entryIds, force);
      },
      getWindow(sourceSessionId, { baseSourceEntryId, force, maxLineCount, overlapLineCount }) {
        return getClaudeTranscriptWindow(sourceSessionId, baseSourceEntryId, {
          force,
          maxLineCount,
          overlapLineCount
        });
      },
      getTailWindow(sourceSessionId, { chatMessageTail, force }) {
        return getClaudeTranscriptTailWindow(sourceSessionId, { chatMessageTail, force });
      },
      getPreviousWindow(sourceSessionId, { beforeEntryId, force }) {
        return getClaudeTranscriptPreviousWindow(sourceSessionId, beforeEntryId, { force });
      }
    }
  },
];

export function getSourceAgentDescriptor(adapterId: string) {
  return sourceAgentDescriptors.find((descriptor) => descriptor.adapterId === adapterId) ?? null;
}
