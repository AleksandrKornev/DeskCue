import type { FetchSessionView } from "@api/endpoint/sessions/types";

export type LoadOptions = {
  debugLogTail?: number;
  force?: boolean;
  requestScope?: string;
  silent?: boolean;
  sessionView?: FetchSessionView;
};
