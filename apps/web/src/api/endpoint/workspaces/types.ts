import type {
  PickWorkspaceResult,
  WorkspaceSummary
} from "@deskcue/protocol";
import type { ApiErrorPayload } from "@api/transport/errors";

export type PickWorkspaceApiResponse =
  | (PickWorkspaceResult & {
      error?: string;
      workspace?: WorkspaceSummary;
    })
  | ApiErrorPayload;
