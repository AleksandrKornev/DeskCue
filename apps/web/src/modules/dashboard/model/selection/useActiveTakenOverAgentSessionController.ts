import { useEffect } from "react";

import { useAgentChatDetailResource } from "@modules/dashboard/model/chatDetail";

import {
  shouldShowActiveTakenOverAgentSessionLoading,
  usesTakenOverAgentTranscript
} from "./helpers";
import type { UseActiveTakenOverAgentSessionControllerArgs } from "./types";

export function useActiveTakenOverAgentSessionController({
  enabled = true,
  isBootstrapping,
  activeTab,
  activeTakenOverAgentSession,
  activeTakenOverAgentSessionSummaryId,
  setActiveTakenOverAgentSession,
  updateActiveTakenOverAgentSession,
  setIsActiveTakenOverAgentSessionLoading
}: UseActiveTakenOverAgentSessionControllerArgs) {
  const shouldLoadTakenOverAgentSession =
    enabled &&
    !isBootstrapping &&
    Boolean(activeTakenOverAgentSessionSummaryId) &&
    usesTakenOverAgentTranscript(activeTab);
  const { snapshot: activeTakenOverAgentSessionSnapshot } = useAgentChatDetailResource({
    activeTab,
    enabled: shouldLoadTakenOverAgentSession,
    onDetail: (session, loadedSessionId) => {
      if (loadedSessionId !== activeTakenOverAgentSessionSummaryId) {
        return;
      }

      setActiveTakenOverAgentSession(session ?? null);
    },
    sessionId: activeTakenOverAgentSessionSummaryId,
    transcriptDetail: "summary"
  });

  useEffect(() => {
    if (isBootstrapping) {
      return;
    }

    if (!enabled || !activeTakenOverAgentSessionSummaryId) {
      setActiveTakenOverAgentSession(null);
      setIsActiveTakenOverAgentSessionLoading(false);
      return;
    }

    if (!usesTakenOverAgentTranscript(activeTab)) {
      setIsActiveTakenOverAgentSessionLoading(false);
      updateActiveTakenOverAgentSession((current) =>
        current?.id === activeTakenOverAgentSessionSummaryId ? current : null
      );
      return;
    }

    updateActiveTakenOverAgentSession((current) =>
      current?.id === activeTakenOverAgentSessionSummaryId ? current : null
    );
    setIsActiveTakenOverAgentSessionLoading(shouldShowActiveTakenOverAgentSessionLoading(
      activeTakenOverAgentSessionSnapshot.status,
      activeTakenOverAgentSession?.id === activeTakenOverAgentSessionSummaryId
    ));
  }, [
    activeTab,
    activeTakenOverAgentSession?.id,
    activeTakenOverAgentSessionSummaryId,
    activeTakenOverAgentSessionSnapshot.status,
    enabled,
    isBootstrapping,
    setActiveTakenOverAgentSession,
    setIsActiveTakenOverAgentSessionLoading,
    updateActiveTakenOverAgentSession
  ]);
}
