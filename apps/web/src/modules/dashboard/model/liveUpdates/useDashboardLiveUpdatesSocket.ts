import { useCallback, useEffect, useRef } from "react";

import { isCompatibleProtocolHello } from "@deskcue/protocol";
import {
  CONNECTION_CONFIG_CHANGED_EVENT,
  emitConnectionConfigChangedEvent,
  fetchSecurityStatus,
  invalidateConnectionConfigCache,
  isConnectionConfigStorageKey,
  isConnectionEpochCurrent,
  isProtocolCompatibilityError,
  readConnectionEpoch
} from "@api/connection";
import {
  acknowledgeLiveUpdateCursor,
  handleLiveUpdatesClose,
  openLiveUpdatesSocket,
  parseLiveUpdateMessage,
  sendLiveSessionPresence
} from "@api/realtime";
import {
  LIVE_UPDATES_OFFLINE_MESSAGE,
  LIVE_UPDATES_RECONNECT_MESSAGE
} from "@models/liveUpdatesConnection";
import { buildManagedSessionLoadOptionsForTab } from "@modules/dashboard/model/selection/managedSessionLoadOptions";
import { getDeskCueRuntime } from "@runtime";

import {
  LIVE_UPDATES_CONNECT_TIMEOUT_MS,
  LIVE_UPDATES_RECONNECT_DELAY_MS,
  LIVE_UPDATES_RECONNECT_NOTICE_DELAY_MS
} from "./helpers";
import { handleLiveUpdateEvent } from "./liveUpdateEventHandlers";
import { createSelectedSessionLogQueue } from "./liveUpdateSelectedSessionLogQueue";
import type { UseDashboardLiveUpdatesSocketArgs } from "./types";

export function useDashboardLiveUpdatesSocket({
  activeTab,
  activeTabRef,
  activeTakenOverAgentSessionIdRef,
  eventStreamAttempt,
  loadSessionRef,
  refreshTakenOverTranscriptNow,
  scheduleTakenOverTranscriptRefresh,
  scheduleSelectedAgentSessionRefresh,
  selectedAgentSessionIdRef,
  selectedSessionId,
  selectedSessionIdRef,
  selectedSessionRef,
  store
}: UseDashboardLiveUpdatesSocketArgs) {
  const runtime = getDeskCueRuntime();
  const realtimeEnabled = runtime.features.realtime;
  const shouldProbeDaemonSecurityStatus = runtime.mode !== "cloud-machine";
  const socketRef = useRef<WebSocket | null>(null);
  const refreshTakenOverTranscriptNowRef = useRef(refreshTakenOverTranscriptNow);
  const scheduleTakenOverTranscriptRefreshRef = useRef(scheduleTakenOverTranscriptRefresh);
  const scheduleSelectedAgentSessionRefreshRef = useRef(scheduleSelectedAgentSessionRefresh);

  refreshTakenOverTranscriptNowRef.current = refreshTakenOverTranscriptNow;
  scheduleTakenOverTranscriptRefreshRef.current = scheduleTakenOverTranscriptRefresh;
  scheduleSelectedAgentSessionRefreshRef.current = scheduleSelectedAgentSessionRefresh;

  const sendPresence = useCallback((sessionId: string) => {
    sendLiveSessionPresence(socketRef.current, sessionId, activeTabRef.current);
  }, [activeTabRef]);

  useEffect(() => {
    sendPresence(selectedSessionId);
  }, [activeTab, selectedSessionId, sendPresence]);

  useEffect(() => {
    if (!realtimeEnabled) {
      return;
    }
    let reconnectTimer: number | null = null;
    let reconnectNoticeTimer: number | null = null;
    let connectTimer: number | null = null;
    let connectionTimeoutTimer: number | null = null;
    let hostOffline = false;
    let browserOffline = !window.navigator.onLine;
    let shouldReconnect = true;
    let socket: WebSocket | null = null;
    let protocolReady = false;
    const connectionEpoch = readConnectionEpoch();
    const selectedSessionLogQueue = createSelectedSessionLogQueue({
      store
    });
    const isEffectCurrent = () => shouldReconnect && isConnectionEpochCurrent(connectionEpoch);
    const isSocketCurrent = () => isEffectCurrent() && socketRef.current === socket;

    const clearConnectionTimeout = () => {
      if (connectionTimeoutTimer === null) {
        return;
      }

      window.clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    };

    const clearReconnectNotice = () => {
      if (reconnectNoticeTimer === null) {
        return;
      }

      window.clearTimeout(reconnectNoticeTimer);
      reconnectNoticeTimer = null;
    };

    const stopForIncompatibleProtocol = () => {
      shouldReconnect = false;
      clearConnectionTimeout();
      clearReconnectNotice();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      store.setLiveUpdatesOffline();
      store.setErrorIfEmpty(
        "This DeskCue page is incompatible with the connected daemon. Reload DeskCue."
      );
    };

    const scheduleReconnect = () => {
      if (!isEffectCurrent() || browserOffline) {
        return;
      }

      if (reconnectTimer !== null) {
        return;
      }

      if (reconnectNoticeTimer === null) {
        reconnectNoticeTimer = window.setTimeout(() => {
          reconnectNoticeTimer = null;
          if (!isEffectCurrent()) {
            return;
          }
          if (!hostOffline && store.liveUpdatesConnection.status !== "offline") {
            store.setLiveUpdatesReconnecting();
          }
          store.setErrorIfEmpty(LIVE_UPDATES_RECONNECT_MESSAGE);
        }, LIVE_UPDATES_RECONNECT_NOTICE_DELAY_MS);
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (!isEffectCurrent()) {
          return;
        }
        store.incrementEventStreamAttempt();
      }, LIVE_UPDATES_RECONNECT_DELAY_MS);
    };

    const connect = () => {
      if (!isEffectCurrent()) {
        return;
      }
      if (!window.navigator.onLine) {
        browserOffline = true;
        hostOffline = true;
        store.setLiveUpdatesOffline();
        store.setErrorIfEmpty(LIVE_UPDATES_OFFLINE_MESSAGE);
        return;
      }
      const wasHostOffline = store.liveUpdatesConnection.status === "offline";
      hostOffline = false;
      if (!wasHostOffline) {
        store.setLiveUpdatesConnecting();
      }

      try {
        socket = openLiveUpdatesSocket();
      } catch {
        scheduleReconnect();
        return;
      }

      socketRef.current = socket;
      connectionTimeoutTimer = window.setTimeout(() => {
        if (isSocketCurrent() && !protocolReady) {
          socket?.close();
        }
      }, LIVE_UPDATES_CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        if (!isSocketCurrent()) {
          socket?.close();
        }
      };

      socket.onmessage = (message) => {
        if (!isSocketCurrent()) {
          return;
        }
        let event;
        try {
          event = parseLiveUpdateMessage(message);
        } catch {
          return;
        }

        if (event.type === "protocol.hello") {
          if (!isCompatibleProtocolHello(event.payload)) {
            stopForIncompatibleProtocol();
            socket?.close();
            return;
          }

          if (protocolReady) {
            return;
          }

          protocolReady = true;
          clearConnectionTimeout();
          clearReconnectNotice();
          store.clearLiveUpdatesReconnectError();
          store.markLiveUpdatesSynced();
          const currentSessionId = selectedSessionIdRef.current;
          sendPresence(currentSessionId);
          if (currentSessionId) {
            void loadSessionRef.current(
              currentSessionId,
              buildManagedSessionLoadOptionsForTab(activeTabRef.current, {
                silent: true
              })
            );
          }
          refreshTakenOverTranscriptNowRef.current(undefined, {
            allowDuringPromptPolling: true,
            reason: "reconnect"
          });
          return;
        }

        if (!protocolReady) {
          return;
        }
        store.markLiveUpdatesSynced();
        acknowledgeLiveUpdateCursor(socket, event);
        handleLiveUpdateEvent({
          activeTabRef,
          activeTakenOverAgentSessionIdRef,
          event,
          loadSessionRef,
          refreshTakenOverTranscriptNow: refreshTakenOverTranscriptNowRef.current,
          scheduleTakenOverTranscriptRefresh: scheduleTakenOverTranscriptRefreshRef.current,
          scheduleSelectedAgentSessionRefresh: scheduleSelectedAgentSessionRefreshRef.current,
          selectedAgentSessionIdRef,
          selectedSessionIdRef,
          selectedSessionLogQueue,
          selectedSessionRef,
          store
        });
      };

      socket.onerror = () => {
        if (isSocketCurrent()) {
          socket?.close();
        }
      };

      socket.onclose = (event) => {
        clearConnectionTimeout();
        const wasCurrentSocket = isSocketCurrent();
        if (socketRef.current === socket) {
          socketRef.current = null;
        }

        if (!wasCurrentSocket) {
          return;
        }

        if (handleLiveUpdatesClose(socket, event)) {
          return;
        }

        if (!window.navigator.onLine) {
          browserOffline = true;
          hostOffline = true;
          store.setLiveUpdatesOffline();
          store.setErrorIfEmpty(LIVE_UPDATES_OFFLINE_MESSAGE);
          return;
        }

        if (shouldProbeDaemonSecurityStatus) {
          void fetchSecurityStatus()
            .then(() => {
              if (isEffectCurrent() && !hostOffline) {
                store.setLiveUpdatesReconnecting();
              }
            })
            .catch((error: unknown) => {
              if (isEffectCurrent()) {
                if (isProtocolCompatibilityError(error)) {
                  stopForIncompatibleProtocol();
                  return;
                }
                hostOffline = true;
                store.setLiveUpdatesOffline();
              }
            });
        } else if (!hostOffline) {
          store.setLiveUpdatesReconnecting();
        }
        scheduleReconnect();
      };
    };

    connectTimer = window.setTimeout(connect, 100);

    const handleConnectionConfigChanged = () => {
      socket?.close();
    };
    const handleStorage = (event: StorageEvent) => {
      if (!isConnectionConfigStorageKey(event.key)) {
        return;
      }

      invalidateConnectionConfigCache();
      emitConnectionConfigChangedEvent();
    };
    const handleBrowserOffline = () => {
      browserOffline = true;
      hostOffline = true;
      clearReconnectNotice();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      store.setLiveUpdatesOffline();
      store.setErrorIfEmpty(LIVE_UPDATES_OFFLINE_MESSAGE);
      socket?.close();
    };
    const handleBrowserOnline = () => {
      if (!browserOffline || !isEffectCurrent()) {
        return;
      }

      browserOffline = false;
      hostOffline = false;
      store.setLiveUpdatesReconnecting();
      store.incrementEventStreamAttempt();
    };
    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, handleConnectionConfigChanged);
    window.addEventListener("offline", handleBrowserOffline);
    window.addEventListener("online", handleBrowserOnline);
    window.addEventListener("storage", handleStorage);

    return () => {
      shouldReconnect = false;
      if (connectTimer !== null) {
        window.clearTimeout(connectTimer);
      }
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      clearConnectionTimeout();
      clearReconnectNotice();
      socket?.close();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      selectedSessionLogQueue.teardown();
      window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, handleConnectionConfigChanged);
      window.removeEventListener("offline", handleBrowserOffline);
      window.removeEventListener("online", handleBrowserOnline);
      window.removeEventListener("storage", handleStorage);
    };
  }, [
    activeTabRef,
    activeTakenOverAgentSessionIdRef,
    eventStreamAttempt,
    loadSessionRef,
    selectedAgentSessionIdRef,
    selectedSessionIdRef,
    selectedSessionRef,
    store,
    sendPresence,
    realtimeEnabled,
    shouldProbeDaemonSecurityStatus
  ]);
}
