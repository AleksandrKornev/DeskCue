import { ProtocolSchemaError } from "./schema.ts";

export interface PreviewConfig {
  port: number | null;
  active: boolean;
  targetUrl: string | null;
  networkMode: PreviewNetworkMode;
  artifacts?: PreviewArtifact[];
}

export type PreviewNetworkMode = "device-direct" | "deskcue-host";

export const DEFAULT_PREVIEW_NETWORK_MODE: PreviewNetworkMode = "device-direct";

export function isPreviewNetworkMode(value: unknown): value is PreviewNetworkMode {
  return value === "device-direct" || value === "deskcue-host";
}

export function normalizePreviewNetworkMode(value: unknown): PreviewNetworkMode {
  return isPreviewNetworkMode(value) ? value : DEFAULT_PREVIEW_NETWORK_MODE;
}

export type PreviewViewport = "desktop" | "mobile";

export interface PreviewArtifact {
  id: string;
  capturedAt: string;
  targetUrl: string;
  viewport: PreviewViewport;
  source: "metadata";
  title: string;
  notes: string[];
}

export type PreviewOwnerKind = "session" | "local-llm";

export interface IssuePreviewTicketInput {
  kind: PreviewOwnerKind;
  ownerId: string;
}

export interface PreviewTicketResponse {
  credentialRevision: string;
  expiresAt: string;
  previewUrl: string;
}

export interface PreviewCandidate {
  configured: boolean;
  port: number;
}

export interface PreviewCandidatesResponse {
  candidates: PreviewCandidate[];
}

function isPreviewDocumentUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const absolute = /^https?:\/\//i.test(value);
    const url = new URL(value, "http://deskcue.invalid");
    return (
      (!absolute || url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/api\/preview\/(?:sessions|local-llm)\/[^/?#]+\/$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function parseIssuePreviewTicketInput(value: unknown): IssuePreviewTicketInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolSchemaError("Expected preview ticket input.");
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "session" && candidate.kind !== "local-llm") {
    throw new ProtocolSchemaError("Choose a valid preview owner kind.");
  }
  if (typeof candidate.ownerId !== "string" || !candidate.ownerId.trim()) {
    throw new ProtocolSchemaError("Choose a preview owner.");
  }
  if (candidate.ownerId.trim().length > 200) {
    throw new ProtocolSchemaError("Preview owner id exceeds the 200-character limit.");
  }

  return {
    kind: candidate.kind,
    ownerId: candidate.ownerId.trim()
  };
}

export function parsePreviewTicketResponse(value: unknown): PreviewTicketResponse {
  const candidate = readPreviewRecord(value, "Expected preview ticket response.");
  if (
    typeof candidate.credentialRevision !== "string" ||
    !/^[A-Za-z0-9_-]{16}$/.test(candidate.credentialRevision) ||
    typeof candidate.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    !isPreviewDocumentUrl(candidate.previewUrl)
  ) {
    throw new ProtocolSchemaError("Preview ticket response is invalid.");
  }
  return {
    credentialRevision: candidate.credentialRevision,
    expiresAt: candidate.expiresAt,
    previewUrl: candidate.previewUrl
  };
}

export function parsePreviewCandidatesResponse(value: unknown): PreviewCandidatesResponse {
  const candidate = readPreviewRecord(value, "Expected preview candidates response.");
  if (!Array.isArray(candidate.candidates) || candidate.candidates.length > 16) {
    throw new ProtocolSchemaError("Preview candidates response is invalid.");
  }
  const ports = new Set<number>();
  const candidates = candidate.candidates.map((entry) => {
    const item = readPreviewRecord(entry, "Preview candidate is invalid.");
    if (
      typeof item.configured !== "boolean" ||
      typeof item.port !== "number" ||
      !Number.isSafeInteger(item.port) ||
      item.port < 1 ||
      item.port > 65_535 ||
      ports.has(item.port)
    ) {
      throw new ProtocolSchemaError("Preview candidate is invalid.");
    }
    ports.add(item.port);
    return { configured: item.configured, port: item.port };
  });
  return { candidates };
}

function readPreviewRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolSchemaError(message);
  }
  return value as Record<string, unknown>;
}
