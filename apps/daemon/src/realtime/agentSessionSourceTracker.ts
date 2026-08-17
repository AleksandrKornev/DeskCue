import { stat } from "node:fs/promises";

import type { AgentSessionSummary, AgentTranscriptEntry } from "@deskcue/protocol";
import type { SourceAgentTurnState } from "#agents/sourceAgentTurnState";

export type AgentSessionFileChangeState =
  | "changed"
  | "new"
  | "unchanged"
  | "unknown";

type FileSignature = {
  mtimeMs: number;
  size: number;
};

type TranscriptSignature = {
  latestEntryId: string | null;
  length: number;
};

function readTranscriptSignature(transcript: AgentTranscriptEntry[]): TranscriptSignature {
  return {
    latestEntryId: transcript.at(-1)?.id ?? null,
    length: transcript.length
  };
}

export class AgentSessionSourceTracker {
  private readonly summaryHashes = new Map<string, string>();
  private readonly summaries = new Map<string, AgentSessionSummary>();
  private readonly fileSignatures = new Map<string, FileSignature>();
  private readonly transcriptSignatures = new Map<string, TranscriptSignature>();

  getSummary(sessionId: string) {
    return this.summaries.get(sessionId);
  }

  hasSummary(sessionId: string) {
    return this.summaries.has(sessionId);
  }

  setSummary(summary: AgentSessionSummary) {
    this.summaries.set(summary.id, summary);
  }

  shouldPublishSummary(summary: AgentSessionSummary) {
    const hash = JSON.stringify(summary);
    if (this.summaryHashes.get(summary.id) === hash) {
      return false;
    }
    this.summaryHashes.set(summary.id, hash);
    return true;
  }

  pruneSummaries(nextIds: Set<string>) {
    for (const sessionId of Array.from(this.summaryHashes.keys())) {
      if (!nextIds.has(sessionId)) {
        this.summaryHashes.delete(sessionId);
        this.summaries.delete(sessionId);
      }
    }
  }

  deleteSession(sessionId: string) {
    this.summaryHashes.delete(sessionId);
    this.summaries.delete(sessionId);
    this.fileSignatures.delete(sessionId);
    this.transcriptSignatures.delete(sessionId);
  }

  async readFileChangeState(
    agentSession: AgentSessionSummary,
    previousState: SourceAgentTurnState | undefined
  ): Promise<AgentSessionFileChangeState> {
    const shouldTrackSession =
      agentSession.workState === "running" || previousState?.phase === "active";

    try {
      const fileStat = await stat(agentSession.filePath);
      const nextSignature = {
        mtimeMs: fileStat.mtimeMs,
        size: fileStat.size
      };
      const previousSignature = this.fileSignatures.get(agentSession.id);
      this.fileSignatures.set(agentSession.id, nextSignature);

      if (!previousSignature) {
        return "new";
      }

      if (
        previousSignature.mtimeMs !== nextSignature.mtimeMs ||
        previousSignature.size !== nextSignature.size
      ) {
        return "changed";
      }

      return "unchanged";
    } catch {
      this.fileSignatures.delete(agentSession.id);
      return shouldTrackSession ? "changed" : "unknown";
    }
  }

  readTranscriptChange(transcript: AgentTranscriptEntry[], sessionId: string) {
    const nextSignature = readTranscriptSignature(transcript);
    const previousSignature = this.transcriptSignatures.get(sessionId);
    this.transcriptSignatures.set(sessionId, nextSignature);

    return {
      changed: Boolean(
        previousSignature &&
          (previousSignature.latestEntryId !== nextSignature.latestEntryId ||
            previousSignature.length !== nextSignature.length)
      ),
      signature: nextSignature
    };
  }
}
