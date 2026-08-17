import {
  useCallback,
  useMemo
} from "react";

import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";
import { toMessage } from "@lib/format";

import { createDashboardAgentSessionActionController } from "./agentSessionActions";
import type { DashboardStore } from "./store";

export function useDashboardAgentSessionActions({
  activeTakenOverAgentSessionSummaryId,
  clearReadyForReview,
  setErrorIfEmpty,
  store
}: {
  activeTakenOverAgentSessionSummaryId: string | null;
  clearReadyForReview: (sessionId: string) => void;
  setErrorIfEmpty: (message: string) => void;
  store: DashboardStore;
}) {
  const controller = useMemo(
    () => createDashboardAgentSessionActionController({
      api: agentSessionsApi,
      clearReadyForReview,
      formatError: toMessage,
      setErrorIfEmpty,
      store
    }),
    [clearReadyForReview, setErrorIfEmpty, store]
  );

  const refreshActiveTakenOverAgentSession = useCallback(
    () => controller.refreshActiveTakenOverAgentSession(
      activeTakenOverAgentSessionSummaryId
    ),
    [activeTakenOverAgentSessionSummaryId, controller]
  );

  return {
    markAgentSessionReviewed: controller.markAgentSessionReviewed,
    refreshActiveTakenOverAgentSession
  };
}
