import type { PreviewNetworkMode } from "@deskcue/protocol";
import { sessionsApi } from "@api/endpoint/sessions/endpoints";

export async function recoverPreviewSession(sessionId: string) {
  try {
    return await sessionsApi.getOne(sessionId);
  } catch {
    return null;
  }
}

export function matchesPreview(
  session: Awaited<ReturnType<typeof sessionsApi.getOne>>,
  port: number | null,
  networkMode: PreviewNetworkMode
) {
  return session?.preview.port === port && session.preview.networkMode === networkMode;
}

export async function recoverPreviewResult(
  sessionId: string,
  port: number | null,
  networkMode: PreviewNetworkMode
) {
  const session = await recoverPreviewSession(sessionId);
  return session && matchesPreview(session, port, networkMode) ? session : null;
}
