export type DiffFileStatus =
  | "added"
  | "copied"
  | "deleted"
  | "modified"
  | "renamed"
  | "unmerged"
  | "untracked"
  | "unknown";

export type DiffLineKind = "addition" | "context" | "deletion" | "meta";

export type DiffReviewLine = {
  kind: DiffLineKind;
  newLine: number | null;
  oldLine: number | null;
  text: string;
};

export type DiffFileReview = {
  additions: number;
  deletions: number;
  hasLineStats: boolean;
  lines: DiffReviewLine[];
  path: string;
  previousPath: string | null;
  status: DiffFileStatus;
};
