import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type { CreateLocalLlmChatInput } from "@deskcue/protocol";
import { isConnectionEpochCurrent } from "@api/connection/events";
import { localLlmChatsApi } from "@api/endpoint/localLlmChats/endpoints";

import { readLocalChatCreationError } from "./helpers";
import type { LocalChatSubmissionController } from "./types";

export function useLocalChatSubmission({
  connectionEpoch
}: { connectionEpoch: number }): LocalChatSubmissionController {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const previousConnectionEpochRef = useRef(connectionEpoch);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setSubmitting(false);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(async (input: CreateLocalLlmChatInput) => {
    if (abortRef.current) return null;

    const abortController = new AbortController();
    const generation = generationRef.current + 1;

    generationRef.current = generation;

    abortRef.current = abortController;
    setSubmitting(true);
    setError(null);

    try {
      const chat = await localLlmChatsApi.create(input, {
        signal: abortController.signal
      });

      if (
        abortController.signal.aborted ||
        generationRef.current !== generation ||
        !isConnectionEpochCurrent(connectionEpoch)
      ) {
        return null;
      }

      return chat;
    } catch (creationError) {
      if (
        !abortController.signal.aborted &&
        generationRef.current === generation &&
        isConnectionEpochCurrent(connectionEpoch)
      ) {
        setError(readLocalChatCreationError(
          creationError,
          "Failed to create local chat"
        ));
      }

      return null;
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null;
        if (generationRef.current === generation) setSubmitting(false);
      }
    }
  }, [connectionEpoch]);

  useEffect(() => {
    if (previousConnectionEpochRef.current === connectionEpoch) return;

    previousConnectionEpochRef.current = connectionEpoch;
    cancel();
  }, [cancel, connectionEpoch]);

  useEffect(() => cancel, [cancel]);

  return {
    cancel,
    clearError,
    create,
    error,
    submitting
  };
}
