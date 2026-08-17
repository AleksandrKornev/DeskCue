import type { AgentSessionSummary } from "@deskcue/protocol";

export type SourceLiveState = Pick<AgentSessionSummary, "workState"> &
  Partial<Pick<AgentSessionSummary, "turnState">>;

export type SourceLiveStateWithAttach = SourceLiveState &
  Pick<AgentSessionSummary, "attachMode">;
