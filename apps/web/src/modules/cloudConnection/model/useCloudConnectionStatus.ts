import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import type { CloudConnectionStatusResponse } from "@deskcue/protocol";
import { cloudApi } from "@api/endpoint/cloud/endpoints";

import { CLOUD_STATUS_REFRESH_MS } from "./constants";

function runCloudStatusRefresh(
  refresh: () => Promise<CloudConnectionStatusResponse | null>
) {
  void refresh();
}

export function useCloudConnectionStatus() {
  const [status, setStatusState] = useState<CloudConnectionStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = requestGenerationRef.current + 1;

    requestGenerationRef.current = generation;
    setLoading(true);

    try {
      const next = await cloudApi.getConnection();

      if (generation !== requestGenerationRef.current) return null;

      setError(null);
      setStatusState(next);
      return next;
    } catch (requestError) {
      if (generation !== requestGenerationRef.current) return null;

      setError(requestError instanceof Error ? requestError.message : "Failed to load Cloud status");
      return null;
    } finally {
      if (generation === requestGenerationRef.current) setLoading(false);
    }
  }, []);

  const setStatus = useCallback((nextStatus: CloudConnectionStatusResponse | null) => {
    requestGenerationRef.current += 1;
    setError(null);
    setLoading(false);
    setStatusState(nextStatus);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(
      runCloudStatusRefresh,
      CLOUD_STATUS_REFRESH_MS,
      refresh
    );

    return () => {
      requestGenerationRef.current += 1;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { error, loading, refresh, setStatus, status };
}
