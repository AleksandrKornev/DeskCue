import type {
  IssuePreviewTicketInput,
  SessionDetail
} from "@deskcue/protocol";

export interface SessionPreviewLocation {
  hostname: string;
  port: string;
  protocol: string;
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
