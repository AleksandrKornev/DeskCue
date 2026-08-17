import { useCallback, useEffect, useState } from "react";

import type { CloudConnectionStatusResponse } from "@deskcue/protocol";
import { cloudApi } from "@api/endpoint/cloud/endpoints";

import { CLOUD_STATUS_REFRESH_MS } from "./constants";

export function useCloudConnectionStatus() {
  const [status, setStatus] = useState<CloudConnectionStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await cloudApi.getConnection();
      setStatus(next);
      setError(null);
      return next;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to load Cloud status");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await refresh();
    };
    void run();
    const timer = window.setInterval(() => void run(), CLOUD_STATUS_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { error, loading, refresh, setStatus, status };
}
