import type { SessionDetail } from "@deskcue/protocol";
import type { LoadOptions } from "@modules/dashboard/model/data/dashboardLoad";

type SessionLoader = (
  sessionId: string,
  options?: LoadOptions
) => Promise<SessionDetail | null>;

export function isCloudControlReceipt(value: unknown, sessionId: string) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    (value as Record<string, unknown>).accepted === true &&
    (value as Record<string, unknown>).sessionId === sessionId);
}

export async function recoverStoppedManagedSession(
  sessionId: string,
  loadSession: SessionLoader
) {
  const session = await loadSession(sessionId, { force: true, silent: true });
  return session?.status === "stopped" ? session : null;
}
