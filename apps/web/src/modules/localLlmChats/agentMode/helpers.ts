import type {
  LocalLlmActionRequest,
  LocalLlmChangeEvidence
} from "./localLlmAgentMode.types";

export function statusCopy(status: LocalLlmActionRequest["status"]) {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "executed":
      return "Completed";
    case "failed":
      return "Failed";
    case "pending":
      return "Approval needed";
  }
}

export function changeEvidenceCopy(
  kind: LocalLlmChangeEvidence["kind"],
  fileCount?: number
) {
  const count = fileCount === undefined
    ? null
    : `${fileCount} ${fileCount === 1 ? "file" : "files"}`;

  switch (kind) {
    case "proposed":
      return {
        description: count
          ? `${count} proposed; files are unchanged`
          : "This patch is proposed; files are unchanged",
        title: "Proposed changes"
      };
    case "applied":
      return {
        description: count
          ? `${count} changed by this turn`
          : "Changes were applied by this turn",
        title: "Applied changes"
      };
    case "observed":
      return {
        description: count
          ? `${count} changed while this turn was active; source is not confirmed`
          : "Workspace activity was detected while this turn was active; source is not confirmed",
        title: "Observed workspace activity"
      };
  }
}
