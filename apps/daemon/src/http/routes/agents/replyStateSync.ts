import type { ManagedSessionService } from "#application/managedSessionService";

export async function syncReplyStateForManagedSession(
  managedSessions: ManagedSessionService,
  sessionId: string
) {
  return managedSessions.syncReplyStateForSession(sessionId);
}
