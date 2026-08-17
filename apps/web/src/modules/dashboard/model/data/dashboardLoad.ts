import type { FetchSessionView } from "@api/endpoint/sessions/types";

export type LoadOptions = {
  debugLogTail?: number;
  force?: boolean;
  silent?: boolean;
  sessionView?: FetchSessionView;
};
