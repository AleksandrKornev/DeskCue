import type {
  IssuePreviewTicketInput,
  SessionDetail
} from "@deskcue/protocol";

export interface SessionPreviewLocation {
  hostname: string;
  port: string;
  protocol: string;
}

export type PreviewPortParseResult =
  | { ok: true; port: number | null }
  | { ok: false };

export function parsePreviewPort(
  value: string,
  fallback: number | null = null
): PreviewPortParseResult {
  const normalized = value.trim();
  const port = normalized ? Number(normalized) : fallback;

  if (port === null) return { ok: true, port };
  if (!/^\d+$/u.test(normalized) && normalized) return { ok: false };
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return { ok: false };

  return { ok: true, port };
}

export function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();

  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function resolvePreviewOwnerIdentity(
  session: Pick<SessionDetail, "id"> | null
): IssuePreviewTicketInput | null {
  if (!session) return null;

  const localChatPrefix = "local-llm-session:";

  if (session.id.startsWith(localChatPrefix)) {
    return {
      kind: "local-llm",
      ownerId: session.id.slice(localChatPrefix.length)
    };
  }

  return {
    kind: "session",
    ownerId: session.id
  };
}

export function resolvePreviewOwner(
  session: SessionDetail | null
): IssuePreviewTicketInput | null {
  if (!session?.preview?.active || !session.preview.port) {
    return null;
  }

  return resolvePreviewOwnerIdentity(session);
}

function defaultPortForProtocol(protocol: string) {
  return protocol === "https:" ? "443" : "80";
}

export function isCurrentDeskCuePreviewPort(
  port: number | null,
  location: Pick<SessionPreviewLocation, "port" | "protocol">
) {
  if (port === null) {
    return false;
  }

  const currentPort = Number(location.port || defaultPortForProtocol(location.protocol));

  return Number.isFinite(currentPort) && port === currentPort;
}
