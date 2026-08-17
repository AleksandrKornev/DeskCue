import type {
  ExternalDesktopInterruptFallback,
  SessionDetail,
  SessionSummary
} from "@deskcue/protocol";

export type SessionUpdateResponse = SessionDetail | SessionSummary;
export type SessionCommandAccepted = {
  accepted: true;
  sessionId: string;
};
export type SessionCommandResponse = SessionUpdateResponse | SessionCommandAccepted;
export type SessionInterruptResponse = SessionCommandResponse | ExternalDesktopInterruptFallback;

export function isSessionCommandAccepted(value: unknown): value is SessionCommandAccepted {
  return Boolean(
    value &&
    typeof value === "object" &&
    "accepted" in value &&
    "sessionId" in value &&
    (value as { accepted?: unknown }).accepted === true &&
    typeof (value as { sessionId?: unknown }).sessionId === "string"
  );
}

export type FetchSessionView = "chat" | "debug" | "diff";

export type FetchSessionOptions = {
  debugLogTail?: number;
  signal?: AbortSignal;
  view?: FetchSessionView;
};

export type SendSessionInputOptions = {
  commandId?: string;
  compact?: boolean;
};

export type RefreshGitOptions = {
  view?: FetchSessionView;
};
