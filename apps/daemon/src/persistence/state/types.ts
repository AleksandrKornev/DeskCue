import type { SessionDetail, WorkspaceSummary } from "@deskcue/protocol";

export interface PersistedDeskCueState {
  version: 1;
  workspaces: WorkspaceSummary[];
  sessions: SessionDetail[];
  partialSessionIds?: string[];
}

export interface PersistedDeskCueStatePatch {
  version: 1;
  workspaces: WorkspaceSummary[];
  sessions: SessionDetail[];
  partialSessionIds?: string[];
}

export type DaemonStateStorage = {
  load: () => Promise<PersistedDeskCueState>;
  save: (state: PersistedDeskCueState) => Promise<void>;
};

export const emptyPersistedDeskCueState: PersistedDeskCueState = {
  version: 1,
  workspaces: [],
  sessions: []
};

export function hasPersistedState(state: PersistedDeskCueState) {
  return state.workspaces.length > 0 || state.sessions.length > 0;
}
