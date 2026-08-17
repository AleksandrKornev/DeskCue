import type { AgentSessionSummary } from "./sessions/agentSession.ts";
import type { AgentTranscriptSourceRange } from "./transcript/sourceRefs.ts";
export type {
  AgentTranscriptSourceRange,
  AgentTranscriptSourceRefs
} from "./transcript/sourceRefs.ts";

export type AgentTranscriptRole =
  | "user"
  | "assistant"
  | "commentary"
  | "tool"
  | "system";

export type CodexTranscriptRole = AgentTranscriptRole;

export type TranscriptPart =
  | {
      type: "markdown";
      text: string;
    }
  | {
      type: "diff";
      title: string;
      text: string;
      filePath: string | null;
      changeType: "add" | "update" | "delete" | "move" | "unknown";
      additions?: number;
      deletions?: number;
    }
  | {
      type: "tool_call";
      toolName: string;
      namespace: string | null;
      argumentsText: string | null;
    }
  | {
      type: "tool_result";
      toolName: string | null;
      status: "completed" | "failed" | "unknown";
      text: string;
    }
  | {
      type: "attachment";
      kind: "image" | "local-image" | "file" | "local-file";
      label: string;
      url: string | null;
      path: string | null;
    }
  | {
      type: "status";
      label: string;
      detail: string | null;
    };

export interface AgentTranscriptEntry {
  id: string;
  timestamp: string;
  role: AgentTranscriptRole;
  text: string;
  phase: string | null;
  origin?: "external";
  isCompact?: boolean;
  sourceEntryIds?: string[];
  sourceEntryRanges?: AgentTranscriptSourceRange[];
  sourceEntrySpans?: AgentTranscriptSourceRange[];
  sourceEntryCount?: number;
  parts?: TranscriptPart[];
}

export type CodexTranscriptEntry = AgentTranscriptEntry;

export type AgentTranscriptActivityKind =
  | "changes"
  | "context"
  | "details"
  | "model"
  | "tools";

export interface AgentTranscriptActivityGroup {
  id: string;
  kind: AgentTranscriptActivityKind;
  label: string;
  timestamp: string;
  entries: AgentTranscriptEntry[];
  entryIds: string[];
  sourceEntryIds?: string[];
  sourceEntryRanges?: AgentTranscriptSourceRange[];
  sourceEntrySpans?: AgentTranscriptSourceRange[];
  sourceEntryCount?: number;
}

export interface AgentTranscriptTurnStatus {
  kind: "failed" | "incomplete" | "interrupted" | "superseded";
  label: string;
  title: string;
}

export type AgentTranscriptViewItem =
  | {
      type: "message";
      key: string;
      role: "user" | "assistant";
      timestamp: string;
      entry: AgentTranscriptEntry;
      activities: AgentTranscriptActivityGroup[];
      changeActivities: AgentTranscriptActivityGroup[];
      turnStatus: AgentTranscriptTurnStatus | null;
    }
  | {
      type: "activity";
      key: string;
      activity: AgentTranscriptActivityGroup;
    };

export interface AgentTranscriptViewResponse {
  sessionId: string;
  updatedAt: string;
  session?: AgentSessionSummary;
  items: AgentTranscriptViewItem[];
  latestWaitingDetailEntry: AgentTranscriptEntry | null;
}

export interface AgentTranscriptViewDeltaResponse extends AgentTranscriptViewResponse {
  replaceFromItemKey: string | null;
}

export interface AgentTranscriptPageResponse {
  entries: AgentTranscriptEntry[];
  hasMore: boolean;
  transcriptView: AgentTranscriptViewResponse;
}

export interface AgentTranscriptEntriesResponse {
  entries: AgentTranscriptEntry[];
}

export interface AgentTranscriptActivityGroupResponse {
  sessionId: string;
  group: AgentTranscriptActivityGroup;
}

export interface AgentTranscriptChangesFile {
  displayPath: string;
  changeType: Extract<TranscriptPart, { type: "diff" }>["changeType"];
  additions: number;
  deletions: number;
  parts: Array<Extract<TranscriptPart, { type: "diff" }>>;
}

export interface AgentTranscriptChangesResponse {
  sessionId: string;
  groupId: string;
  files: AgentTranscriptChangesFile[];
}

export {
  buildAgentTranscriptSourceRefsKey,
  compactAgentTranscriptSourceRefs,
  countAgentTranscriptSourceRefs,
  doAgentTranscriptSourceRefsOverlap,
  expandAgentTranscriptSourceRanges
} from "./transcript/sourceRefs.ts";
