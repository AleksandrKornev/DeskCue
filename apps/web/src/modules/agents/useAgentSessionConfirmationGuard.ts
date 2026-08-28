import {
  useCallback,
  useEffect,
  useRef
} from "react";

import { requestConfirmation } from "@components/ModalDialog";
import type { ConfirmationOptions } from "@components/ModalDialog";

type AgentSessionConfirmationState = {
  accessKey: string;
  sessionId: string | null;
};

export function useAgentSessionConfirmationGuard({
  accessKey,
  sessionId
}: AgentSessionConfirmationState) {
  const currentStateRef = useRef<AgentSessionConfirmationState>({ accessKey, sessionId });
  const pendingControllerRef = useRef<AbortController | null>(null);

  currentStateRef.current = { accessKey, sessionId };

  useEffect(() => {
    pendingControllerRef.current?.abort();
    pendingControllerRef.current = null;
  }, [accessKey, sessionId]);

  useEffect(() => () => {
    pendingControllerRef.current?.abort();
    pendingControllerRef.current = null;
  }, []);

  return useCallback(async (options: ConfirmationOptions) => {
    const expectedState = currentStateRef.current;
    const controller = new AbortController();

    pendingControllerRef.current?.abort();

    pendingControllerRef.current = controller;

    const confirmed = await requestConfirmation(options, { signal: controller.signal });

    if (pendingControllerRef.current === controller) pendingControllerRef.current = null;

    return confirmed &&
      currentStateRef.current.sessionId === expectedState.sessionId &&
      currentStateRef.current.accessKey === expectedState.accessKey;
  }, []);
}
