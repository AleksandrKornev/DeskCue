import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type { LocalLlmRuntimeId, RuntimeSummary } from "@deskcue/protocol";
import { isConnectionEpochCurrent } from "@api/connection/events";

import {
  normalizeLocalChatCreationModels,
  readLocalChatCreationError
} from "./helpers";
import { getLocalChatRuntimeCatalogContract } from "./runtimeCatalogContract";
import type { LocalChatRuntimeCatalogState } from "./types";

interface UseLocalRuntimeCatalogOptions {
  active: boolean;
  connectionEpoch: number;
  runtimeId: LocalLlmRuntimeId;
}

interface LocalRuntimeCatalogController {
  cancel: () => void;
  retry: () => void;
  state: LocalChatRuntimeCatalogState;
}

const IDLE_CATALOG_STATE: LocalChatRuntimeCatalogState = {
  error: null,
  models: [],
  runtime: null,
  status: "idle"
};

function isCatalogRequestCurrent(
  abortController: AbortController,
  connectionEpoch: number,
  generation: number,
  generationRef: { current: number }
) {
  return !abortController.signal.aborted &&
    generationRef.current === generation &&
    isConnectionEpochCurrent(connectionEpoch);
}

export function useLocalRuntimeCatalog({
  active,
  connectionEpoch,
  runtimeId
}: UseLocalRuntimeCatalogOptions): LocalRuntimeCatalogController {
  const [state, setState] = useState<LocalChatRuntimeCatalogState>(IDLE_CATALOG_STATE);
  const [requestVersion, setRequestVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE_CATALOG_STATE);
  }, []);

  const retry = useCallback(() => {
    if (
      state.status === "starting_runtime" ||
      state.status === "loading_models"
    ) {
      return;
    }
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setState({
      error: null,
      models: [],
      runtime: null,
      status: "starting_runtime"
    });
    setRequestVersion((version) => version + 1);
  }, [state.status]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const contract = getLocalChatRuntimeCatalogContract(runtimeId);
    const abortController = new AbortController();
    const generation = generationRef.current + 1;
    let runtime: RuntimeSummary | null = null;
    generationRef.current = generation;
    abortRef.current = abortController;
    setState({
      error: null,
      models: [],
      runtime: null,
      status: "starting_runtime"
    });

    const loadCatalog = async () => {
      try {
        const startResponse = await contract.start({ signal: abortController.signal });
        if (!isCatalogRequestCurrent(
          abortController,
          connectionEpoch,
          generation,
          generationRef
        )) {
          return;
        }

        runtime = startResponse.runtime;
        setState({
          error: null,
          models: [],
          runtime,
          status: "loading_models"
        });
        const modelsResponse = await contract.listModels({ signal: abortController.signal });
        if (!isCatalogRequestCurrent(
          abortController,
          connectionEpoch,
          generation,
          generationRef
        )) {
          return;
        }

        setState({
          error: null,
          models: normalizeLocalChatCreationModels(modelsResponse.models),
          runtime,
          status: "ready"
        });
      } catch (error) {
        if (!isCatalogRequestCurrent(
          abortController,
          connectionEpoch,
          generation,
          generationRef
        )) {
          return;
        }
        setState({
          error: readLocalChatCreationError(
            error,
            "Failed to load installed local models"
          ),
          models: [],
          runtime,
          status: "error"
        });
      } finally {
        if (abortRef.current === abortController) {
          abortRef.current = null;
        }
      }
    };

    void loadCatalog();
    return () => {
      abortController.abort();
      if (abortRef.current === abortController) {
        abortRef.current = null;
      }
    };
  }, [active, connectionEpoch, requestVersion, runtimeId]);

  useEffect(() => cancel, [cancel]);

  return { cancel, retry, state };
}
