import type { WebSocket } from "ws";

type ClientPresence = {
  clientId: string | null;
  sessionId: string | null;
  sessionTab: string | null;
};

export class LiveSessionPresence {
  private readonly clientSessionPresence = new Map<WebSocket, ClientPresence>();

  addClient(socket: WebSocket) {
    this.clientSessionPresence.set(socket, {
      clientId: null,
      sessionId: null,
      sessionTab: null
    });
  }

  deleteClient(socket: WebSocket) {
    const activeSessionId = this.clientSessionPresence.get(socket)?.sessionId ?? null;
    this.clientSessionPresence.delete(socket);
    return activeSessionId;
  }

  getViewerCountForSession(sessionId: string) {
    const anonymousSockets = new Set<WebSocket>();
    const identifiedClients = new Set<string>();

    for (const [socket, presence] of this.clientSessionPresence) {
      if (presence.sessionId !== sessionId) {
        continue;
      }

      if (presence.clientId) {
        identifiedClients.add(presence.clientId);
      } else {
        anonymousSockets.add(socket);
      }
    }

    return identifiedClients.size + anonymousSockets.size;
  }

  isClientViewingSessionLogs(socket: WebSocket, sessionId: string) {
    const presence = this.clientSessionPresence.get(socket);
    return presence?.sessionId === sessionId && presence.sessionTab === "logs";
  }

  updateClientSession(
    socket: WebSocket,
    sessionId: string | null,
    clientId?: string | null,
    sessionTab?: string | null
  ) {
    const previousPresence = this.clientSessionPresence.get(socket) ?? {
      clientId: null,
      sessionId: null,
      sessionTab: null
    };
    const previousSessionId = previousPresence.sessionId;
    const nextClientId = clientId?.trim() || previousPresence.clientId;
    const nextSessionTab = sessionTab?.trim() || null;

    if (
      previousSessionId === sessionId &&
      previousPresence.clientId === nextClientId &&
      previousPresence.sessionTab === nextSessionTab
    ) {
      return null;
    }

    this.clientSessionPresence.set(socket, {
      clientId: nextClientId,
      sessionId,
      sessionTab: nextSessionTab
    });
    return {
      previousSessionId,
      sessionId
    };
  }
}
