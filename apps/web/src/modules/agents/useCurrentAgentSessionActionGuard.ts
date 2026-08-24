import { useEffect, useRef } from "react";

export function useCurrentAgentSessionActionGuard(sessionId: string | null) {
  const currentSessionIdRef = useRef<string | null>(sessionId);

  currentSessionIdRef.current = sessionId;

  useEffect(() => () => {
    currentSessionIdRef.current = null;
  }, []);

  return currentSessionIdRef;
}
