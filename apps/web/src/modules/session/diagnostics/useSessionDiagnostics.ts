import { useEffect, useRef, useState } from "react";

import { sessionsApi } from "@api/endpoint/sessions/endpoints";
import { buildDebugLogEntries } from "@models/sessionDisplay";
import type { DebugEntry } from "@modules/session/tabs/types";

import { SESSION_DIAGNOSTICS_LOG_TAIL } from "./constants";

export function useSessionDiagnostics({
  fallbackEntries,
  isOpen,
  sessionId
}: {
  fallbackEntries: DebugEntry[];
  isOpen: boolean;
  sessionId: string | null;
}) {
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [error, setError] = useState("");
  const [hydratedSessionId, setHydratedSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const operationRef = useRef(0);

  useEffect(() => {
    if (!isOpen || !sessionId) {
      operationRef.current += 1;
      setError("");
      setLoading(false);
      return;
    }

    const operation = ++operationRef.current;
    const controller = new AbortController();
    setError("");
    setLoading(true);
    void sessionsApi.getOne(sessionId, {
      debugLogTail: SESSION_DIAGNOSTICS_LOG_TAIL,
      signal: controller.signal,
      view: "debug"
    }).then((session) => {
      if (operationRef.current !== operation) return;
      if (!session) throw new Error("Session diagnostics are no longer available");
      setEntries(buildDebugLogEntries(session.logs, {
        mode: session.sourceSessionId ? "taken-over" : "manual"
      }));
      setHydratedSessionId(sessionId);
    }).catch((loadError: unknown) => {
      if (controller.signal.aborted || operationRef.current !== operation) return;
      setError(loadError instanceof Error
        ? loadError.message
        : "Failed to load session diagnostics");
    }).finally(() => {
      if (operationRef.current === operation) setLoading(false);
    });

    return () => controller.abort();
  }, [isOpen, sessionId]);

  return {
    entries: hydratedSessionId === sessionId ? entries : fallbackEntries,
    error,
    loading
  };
}
