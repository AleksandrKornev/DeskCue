import type { AgentSessionDetail, AgentSessionSummary, SessionSummary } from "@deskcue/protocol";

export type AttachedManagedSessionInfo = Pick<
  SessionSummary,
  "id" | "status" | "viewerCount"
>;

export interface AgentTranscriptPanelProps {
  selectedSessionId: string;
  session: AgentSessionDetail | null;
  sessionSummary?: AgentSessionSummary | null;
  isLoading: boolean;
  loadError?: string | null;
  attaching: boolean;
  attachedManagedSessionId: string | null;
  attachedManagedSessionInfo: AttachedManagedSessionInfo | null;
  readyForReviewAgentSessionIds: ReadonlySet<string>;
  previewItems?: number;
  onAttach: () => void;
  onMarkReviewed: (sessionId: string) => void;
  onOpenManagedSession: (sessionId: string) => void;
  onRetryLoad?: () => void;
}

export type TranscriptEntry = AgentSessionDetail["transcript"][number];

export interface TimelineActivity {
  id: string;
  kind: "tools" | "details";
  label: string;
  timestamp: string;
  entries: TranscriptEntry[];
}

export type TranscriptTimelineItem =
  | {
      id: string;
      type: "entry";
      entry: TranscriptEntry;
      activities: TimelineActivity[];
    }
  | {
      id: string;
      type: "activity";
      activity: TimelineActivity;
    };

export type TranscriptEntryTimelineItem = Extract<TranscriptTimelineItem, { type: "entry" }>;

export type TextOnlyTranscriptEntry = {
  id: string;
  role: TranscriptEntry["role"];
  timestamp: string;
  text: string;
};

export type AttachWaitStage = "idle" | "starting" | "slow";
