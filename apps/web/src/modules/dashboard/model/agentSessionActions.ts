import { agentSessionsApi } from "@api/endpoint/agentSessions/endpoints";

import type { DashboardStore } from "./store";

export type AgentSessionApi = Pick<typeof agentSessionsApi, "getOne" | "markReviewed">;

export type AgentSessionActionStore = Pick<
  DashboardStore,
  | "activeTakenOverAgentSession"
  | "markAgentSessionReviewedAt"
  | "mergeActiveTakenOverAgentSessionDetail"
>;

export type DashboardAgentSessionActionControllerOptions = {
  api: AgentSessionApi;
  clearReadyForReview: (sessionId: string) => void;
  formatError: (error: unknown) => string;
  setErrorIfEmpty: (message: string) => void;
  store: AgentSessionActionStore;
};

export function createDashboardAgentSessionActionController({
  api,
  clearReadyForReview,
  formatError,
  setErrorIfEmpty,
  store
}: DashboardAgentSessionActionControllerOptions) {
  return {
    markAgentSessionReviewed(sessionId: string) {
      clearReadyForReview(sessionId);
      api.markReviewed(sessionId)
        .then((result) => {
          store.markAgentSessionReviewedAt(result.agentSessionId, result.reviewedAt);
        })
        .catch((error) => {
          setErrorIfEmpty(formatError(error));
        });
    },

    async refreshActiveTakenOverAgentSession(agentSessionId: string | null) {
      if (!agentSessionId) {
        return;
      }

      try {
        const session = await api.getOne(agentSessionId, { omitTranscript: true });
        if (!session) {
          return;
        }

        const cachedTranscript =
          store.activeTakenOverAgentSession?.id === session.id
            ? store.activeTakenOverAgentSession
            : null;
        store.mergeActiveTakenOverAgentSessionDetail({
          ...session,
          transcript: cachedTranscript?.transcript ?? session.transcript,
          transcriptView: cachedTranscript?.transcriptView ?? session.transcriptView
        });
      } catch {
        // The normal live refresh retries lightweight metadata failures.
      }
    }
  };
}
