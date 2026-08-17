import { useEffect, useState } from "react";

import type { SessionDetail, SessionSummary } from "@deskcue/protocol";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import { getDeskCueRuntime } from "@runtime";

export function useExternalClaudeBackgroundStopCapability(
  session: SessionDetail | SessionSummary | null
) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  const sessionId = session?.id ?? "";
  const sourceSessionId = session?.sourceSessionId ?? null;
  const externalHostProcessControlsEnabled =
    getDeskCueRuntime().features.externalHostProcessControls;
  const isExternalClaudeSession =
    externalHostProcessControlsEnabled &&
    session?.adapterId === "claude-code" && Boolean(sourceSessionId) && session?.status === "read_only";

  useEffect(() => {
    let cancelled = false;
    setIsAvailable(false);

    if (!isExternalClaudeSession || !sessionId) {
      return () => {
        cancelled = true;
      };
    }

    void sessionsApi.getExternalClaudeBackgroundStopCapability(sessionId)
      .then((capability) => {
        if (!cancelled) {
          setIsAvailable(capability?.kind === "available");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isExternalClaudeSession, refreshVersion, sessionId, sourceSessionId]);

  return {
    isAvailable,
    refresh: () => setRefreshVersion((current) => current + 1)
  };
}
