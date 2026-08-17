import type { DiffFileGroup, DiffPart } from "@modules/transcript/RichTranscriptContent/types";

export interface DiffPathParts {
  directory: string;
  fileName: string;
}

export type TranscriptDiffListProps = {
  parts: DiffPart[];
};

export type DiffStatsProps = {
  group: Pick<DiffFileGroup, "additions" | "deletions" | "changeType">;
};

export type DiffPathProps = {
  displayPath: string;
};

export type TranscriptDiffModalProps = {
  group: DiffFileGroup;
  onClose: () => void;
};
