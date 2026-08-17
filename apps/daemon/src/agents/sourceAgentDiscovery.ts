import type {
  AgentSessionDetail,
  AgentSessionSummary,
  SessionSummary,
  WorkspaceSummary
} from "@deskcue/protocol";
import { getCodexSessionDetail, listCodexSessions } from "#agents/codex/codexFacade";
import { SourceAgentSessionIndex } from "#agents/sourceAgentSessionIndex";
import {
  buildAgentSessionId,
  getAgentSessionDetail,
  getAgentSessionVersion,
  getAgentSessionTranscriptEntries,
  getAgentSessionTranscriptPreviousWindow,
  getAgentSessionTranscriptTailWindow,
  getAgentSessionTranscriptWindow,
  listAgentSessionPage,
  listAgentSessions
} from "#agents/sourceAgentSessions";
import type { SourceAgentLightweightMode } from "#agents/sourceAgentSessions";
import type { SourceAgentSessionDiscovery } from "#application/ports";

export class LocalSourceAgentSessionDiscovery implements SourceAgentSessionDiscovery {
  constructor(private readonly sessionIndex = new SourceAgentSessionIndex()) {}

  close() {
    return this.sessionIndex.close();
  }

  readIndexStats() {
    return this.sessionIndex.readStats();
  }

  listRecentSessions(
    limit: number,
    workspaces: WorkspaceSummary[],
    options: {
      force?: boolean;
      includeLiveMetadata?: boolean;
    } = {}
  ): Promise<AgentSessionSummary[]> {
    return listAgentSessions(this.sessionIndex, limit, workspaces, options);
  }

  listRecentSessionPage(
    limit: number,
    workspaces: WorkspaceSummary[],
    options: {
      force?: boolean;
      includeLiveMetadata?: boolean;
      offset?: number;
      query?: string | null;
    } = {}
  ) {
    return listAgentSessionPage(this.sessionIndex, limit, workspaces, options);
  }

  getSessionDetail(
    agentSessionId: string,
    includeLiveMetadata = false,
    transcriptTail?: number,
    chatMessageTail?: number,
    options: {
      lightweight?: SourceAgentLightweightMode;
    } = {}
  ): Promise<AgentSessionDetail | null> {
    return getAgentSessionDetail(
      agentSessionId,
      includeLiveMetadata,
      transcriptTail,
      chatMessageTail,
      options
    );
  }

  getSessionVersion(agentSessionId: string) {
    return getAgentSessionVersion(agentSessionId);
  }

  getSessionDetailForManagedSession(
    session: SessionSummary,
    transcriptTail?: number,
    chatMessageTail?: number
  ): Promise<AgentSessionDetail | null> {
    if (!session.sourceSessionId) {
      return Promise.resolve(null);
    }

    return getAgentSessionDetail(
      buildAgentSessionId(session.adapterId, session.sourceSessionId),
      false,
      transcriptTail,
      chatMessageTail
    );
  }

  getTranscriptEntries(agentSessionId: string, entryIds: string[]) {
    return getAgentSessionTranscriptEntries(agentSessionId, entryIds);
  }

  getTranscriptWindow(
    agentSessionId: string,
    options: {
      baseSourceEntryId: string;
      maxLineCount?: number;
      overlapLineCount?: number;
    }
  ) {
    return getAgentSessionTranscriptWindow(agentSessionId, options);
  }

  getTranscriptTailWindow(
    agentSessionId: string,
    options: {
      chatMessageTail?: number;
    } = {}
  ) {
    return getAgentSessionTranscriptTailWindow(agentSessionId, options);
  }

  getTranscriptPreviousWindow(
    agentSessionId: string,
    options: {
      beforeEntryId: string;
    }
  ) {
    return getAgentSessionTranscriptPreviousWindow(agentSessionId, options);
  }

  listCodexSessions() {
    return listCodexSessions();
  }

  getCodexSessionDetail(sessionId: string) {
    return getCodexSessionDetail(sessionId);
  }
}
