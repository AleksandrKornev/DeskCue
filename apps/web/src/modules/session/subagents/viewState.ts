const SUBAGENT_PANEL_STATE_KEY = "deskCueSubagentPanel";

export type SubagentPanelViewState = {
  expanded: boolean;
  parentSessionId: string;
  returnFocusSessionId: string | null;
  scrollTop: number;
  windowScrollY: number | null;
};

function readRecord(value: unknown) {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function readUserState(historyState: unknown) {
  const rootState = readRecord(historyState);

  return readRecord(rootState?.usr) ?? rootState;
}

export function readSubagentPanelViewState(
  historyState: unknown,
  parentSessionId: string
): SubagentPanelViewState {
  const panelState = readRecord(readUserState(historyState)?.[SUBAGENT_PANEL_STATE_KEY]);

  if (panelState?.parentSessionId !== parentSessionId) {
    return {
      expanded: false,
      parentSessionId,
      returnFocusSessionId: null,
      scrollTop: 0,
      windowScrollY: null
    };
  }

  return {
    expanded: panelState.expanded === true,
    parentSessionId,
    returnFocusSessionId: typeof panelState.returnFocusSessionId === "string"
      ? panelState.returnFocusSessionId
      : null,
    scrollTop: typeof panelState.scrollTop === "number" && Number.isFinite(panelState.scrollTop)
      ? Math.max(panelState.scrollTop, 0)
      : 0,
    windowScrollY: typeof panelState.windowScrollY === "number" &&
      Number.isFinite(panelState.windowScrollY)
      ? Math.max(panelState.windowScrollY, 0)
      : null
  };
}

export function writeSubagentPanelViewState(
  historyState: unknown,
  viewState: SubagentPanelViewState
) {
  const rootState = readRecord(historyState) ?? {};
  const userState = readUserState(rootState) ?? {};
  const nextUserState = {
    ...userState,
    [SUBAGENT_PANEL_STATE_KEY]: viewState
  };

  return Object.hasOwn(rootState, "usr")
    ? { ...rootState, usr: nextUserState }
    : { ...rootState, ...nextUserState };
}
