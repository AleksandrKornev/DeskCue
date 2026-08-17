import { useEffect, useState } from "react";

import {
  CONNECTION_CONFIG_CHANGED_EVENT,
  emitConnectionConfigChangedEvent,
  fetchSecurityStatus,
  invalidateConnectionConfigCache,
  isConnectionConfigStorageKey
} from "@api/connection";
import { handleLiveUpdatesClose, openAccessMonitorSocket } from "@api/realtime";
import { API_UNAUTHORIZED_EVENT, isApiUnauthorizedError } from "@api/transport/httpClient";

import {
  ACCESS_CHECK_MAX_WAIT_MS,
  ACCESS_MONITOR_RECONNECT_DELAY_MS
} from "./constants";
import type { AccessState } from "./types";

export function useAccessGateController(pathname: string) {
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [accessCheckVersion, setAccessCheckVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setAccessState("offline");
      }
    }, ACCESS_CHECK_MAX_WAIT_MS);

    setAccessState("checking");
    fetchSecurityStatus()
      .then(() => {
        if (!cancelled) {
          window.clearTimeout(timeoutId);
          setAccessState("allowed");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          window.clearTimeout(timeoutId);
          setAccessState(isApiUnauthorizedError(error) ? "unauthorized" : "offline");
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [accessCheckVersion]);

  useEffect(() => {
    if (accessState !== "allowed" || pathname === "/connect") {
      return;
    }

    let reconnectTimer = 0;
    let shouldReconnect = true;
    let socket: WebSocket | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = 0;
      }
    };
    let connect: (() => void) | null = null;
    const scheduleReconnect = () => {
      if (shouldReconnect && !reconnectTimer) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = 0;
          connect?.();
        }, ACCESS_MONITOR_RECONNECT_DELAY_MS);
      }
    };
    connect = () => {
      if (!shouldReconnect) {
        return;
      }

      try {
        socket = openAccessMonitorSocket();
      } catch {
        scheduleReconnect();
        return;
      }

      socket.onopen = clearReconnectTimer;
      socket.onerror = () => socket?.close();
      socket.onclose = (event) => {
        if (handleLiveUpdatesClose(socket, event)) {
          shouldReconnect = false;
          return;
        }

        socket = null;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      shouldReconnect = false;
      clearReconnectTimer();
      socket?.close();
    };
  }, [accessState, pathname]);

  useEffect(() => {
    const recheckAccess = () => {
      setAccessState("checking");
      setAccessCheckVersion((version) => version + 1);
    };
    const handleResume = () => {
      if (document.visibilityState !== "hidden") {
        invalidateConnectionConfigCache();
        recheckAccess();
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (isConnectionConfigStorageKey(event.key)) {
        invalidateConnectionConfigCache();
        emitConnectionConfigChangedEvent();
      }
    };
    const handleUnauthorized = () => setAccessState("unauthorized");

    window.addEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, recheckAccess);
    window.addEventListener("online", handleResume);
    window.addEventListener("pageshow", handleResume);
    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(API_UNAUTHORIZED_EVENT, handleUnauthorized);
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, recheckAccess);
      window.removeEventListener("online", handleResume);
      window.removeEventListener("pageshow", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return accessState;
}
