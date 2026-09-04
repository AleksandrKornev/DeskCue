const SUBAGENT_NAVIGATION_STATE_KEY = "deskCueSubagentNavigation";

type SubagentNavigationState = {
  childSessionId: string;
  parentHistoryIndex?: number;
  parentSessionId: string;
  returnMode?: "history" | "replace";
};

function readRecord(value: unknown) {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function readSubagentNavigationState(historyState: unknown) {
  const rootState = readRecord(historyState);
  const userState = readRecord(rootState?.usr) ?? rootState;
  const navigationState = readRecord(userState?.[SUBAGENT_NAVIGATION_STATE_KEY]);

  if (
    typeof navigationState?.childSessionId !== "string" ||
    typeof navigationState.parentSessionId !== "string" ||
    (
      navigationState.returnMode !== undefined &&
      navigationState.returnMode !== "history" &&
      navigationState.returnMode !== "replace"
    )
  ) {
    return null;
  }

  return navigationState as SubagentNavigationState;
}

function readHistoryIndex(historyState: unknown) {
  const historyIndex = readRecord(historyState)?.idx;

  return typeof historyIndex === "number" && Number.isInteger(historyIndex) && historyIndex >= 0
    ? historyIndex
    : null;
}

export function createSubagentNavigationState(
  parentSessionId: string,
  childSessionId: string,
  returnMode: "history" | "replace" = "history",
  parentHistoryIndex?: number | null
) {
  return {
    [SUBAGENT_NAVIGATION_STATE_KEY]: {
      childSessionId,
      parentSessionId,
      returnMode,
      ...(parentHistoryIndex === null || parentHistoryIndex === undefined
        ? {}
        : { parentHistoryIndex })
    }
  };
}

export function readSubagentParentHistoryDelta(
  historyState: unknown,
  parentSessionId: string,
  childSessionId: string
) {
  const navigationState = readSubagentNavigationState(historyState);
  const currentHistoryIndex = readHistoryIndex(historyState);
  const parentHistoryIndex = navigationState?.parentHistoryIndex;

  if (
    navigationState?.parentSessionId !== parentSessionId ||
    navigationState.childSessionId !== childSessionId ||
    navigationState.returnMode === "replace" ||
    typeof parentHistoryIndex !== "number" ||
    !Number.isInteger(parentHistoryIndex) ||
    parentHistoryIndex < 0 ||
    currentHistoryIndex === null ||
    parentHistoryIndex >= currentHistoryIndex
  ) {
    return null;
  }

  return parentHistoryIndex - currentHistoryIndex;
}

export function canReturnToSubagentParent(
  historyState: unknown,
  parentSessionId: string,
  childSessionId: string
) {
  return readSubagentParentHistoryDelta(historyState, parentSessionId, childSessionId) !== null;
}

export function readSubagentParentSessionId(
  historyState: unknown,
  childSessionId: string
) {
  const navigationState = readSubagentNavigationState(historyState);

  return navigationState?.childSessionId === childSessionId
    ? navigationState.parentSessionId
    : null;
}

export function readSubagentParentHistoryIndex(
  historyState: unknown,
  childSessionId: string
) {
  const navigationState = readSubagentNavigationState(historyState);
  const parentHistoryIndex = navigationState?.parentHistoryIndex;

  return navigationState?.childSessionId === childSessionId &&
    typeof parentHistoryIndex === "number" &&
    Number.isInteger(parentHistoryIndex) &&
    parentHistoryIndex >= 0
    ? parentHistoryIndex
    : null;
}

export function readCurrentHistoryIndex(historyState: unknown) {
  return readHistoryIndex(historyState);
}

export function createManagedSessionNavigation(
  historyState: unknown,
  subagentParentSessionId: string | undefined,
  childSessionId: string
) {
  if (!subagentParentSessionId) {
    return { replace: false, state: undefined };
  }

  const parentHistoryIndex = readSubagentParentHistoryIndex(historyState, childSessionId);
  const canReturnToParent = canReturnToSubagentParent(
    historyState,
    subagentParentSessionId,
    childSessionId
  );

  return {
    replace: true,
    state: createSubagentNavigationState(
      subagentParentSessionId,
      childSessionId,
      canReturnToParent ? "history" : "replace",
      canReturnToParent ? parentHistoryIndex : null
    )
  };
}

export function resetDashboardScroll() {
  if (typeof window === "undefined") {
    return;
  }

  window.scrollTo({ top: 0, left: 0, behavior: "auto" });

  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}

export function resolveNavigateAgentSessionId({
  nextAgentSessionId,
  routeAgentSessionId,
  selectedAgentSessionId
}: {
  nextAgentSessionId?: string;
  routeAgentSessionId: string;
  selectedAgentSessionId: string;
}) {
  return nextAgentSessionId ?? (routeAgentSessionId || selectedAgentSessionId);
}
