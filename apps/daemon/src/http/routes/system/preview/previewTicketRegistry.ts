import { createHash, randomBytes } from "node:crypto";

import type { PreviewOwner } from "./previewTargetResolver.ts";

export const PREVIEW_TICKET_QUERY_KEY = "deskcuePreviewTicket";
export const PREVIEW_TICKET_PATH_SEGMENT = "__deskcue_ticket__";
export const PREVIEW_TICKET_COOKIE_NAME = "deskcue_preview";
export const PREVIEW_TICKET_COOKIE_PREFIX = `${PREVIEW_TICKET_COOKIE_NAME}_`;
export const PREVIEW_TICKET_TTL_MS = 5 * 60 * 1000;
const MAX_PREVIEW_TICKETS = 256;

type PreviewTicketRecord = PreviewOwner & {
  expiresAtMs: number;
  viewerKey: string;
};

function hashTicket(ticket: string) {
  return createHash("sha256").update(ticket).digest("hex");
}

function buildCredentialRevision(ticket: string) {
  return createHash("sha256").update(ticket).digest("base64url").slice(0, 16);
}

export class PreviewTicketRegistry {
  private readonly records = new Map<string, PreviewTicketRecord>();

  issue(owner: PreviewOwner, viewerKey = "local-preview", nowMs = Date.now()) {
    this.prune(nowMs);
    while (this.records.size >= MAX_PREVIEW_TICKETS) {
      const oldest = this.records.keys().next().value;
      if (!oldest) break;
      this.records.delete(oldest);
    }

    const ticket = randomBytes(32).toString("base64url");
    const expiresAtMs = nowMs + PREVIEW_TICKET_TTL_MS;
    this.records.set(hashTicket(ticket), { ...owner, expiresAtMs, viewerKey });
    return { credentialRevision: buildCredentialRevision(ticket), expiresAtMs, ticket };
  }

  issueOrRenew(
    owner: PreviewOwner,
    viewerKey: string,
    candidate: string | null,
    nowMs = Date.now()
  ) {
    const current = this.read(candidate, owner, nowMs);
    if (!candidate || !current || current.viewerKey !== viewerKey) {
      return this.issue(owner, viewerKey, nowMs);
    }
    const key = hashTicket(candidate);
    const expiresAtMs = nowMs + PREVIEW_TICKET_TTL_MS;
    this.records.delete(key);
    this.records.set(key, { ...current, expiresAtMs });
    return {
      credentialRevision: buildCredentialRevision(candidate),
      expiresAtMs,
      ticket: candidate
    };
  }

  validate(ticket: string | null, owner: PreviewOwner, nowMs = Date.now()) {
    return Boolean(this.read(ticket, owner, nowMs));
  }

  readViewerKey(ticket: string | null, owner: PreviewOwner, nowMs = Date.now()) {
    return this.read(ticket, owner, nowMs)?.viewerKey ?? null;
  }

  resolveOwner(ticket: string | null, nowMs = Date.now()): PreviewOwner | null {
    const record = this.readRecord(ticket, nowMs);
    return record ? { id: record.id, kind: record.kind } : null;
  }

  private read(ticket: string | null, owner: PreviewOwner, nowMs: number) {
    const record = this.readRecord(ticket, nowMs);
    return record?.kind === owner.kind && record.id === owner.id ? record : null;
  }

  private readRecord(ticket: string | null, nowMs: number) {
    if (!ticket || ticket.length > 128) return null;
    const key = hashTicket(ticket);
    const record = this.records.get(key);
    if (!record || record.expiresAtMs <= nowMs) {
      this.records.delete(key);
      return null;
    }
    return record;
  }

  clear() {
    this.records.clear();
  }

  private prune(nowMs: number) {
    for (const [key, record] of this.records) {
      if (record.expiresAtMs <= nowMs) this.records.delete(key);
    }
  }
}

export function buildPreviewOwnerTicketKey(owner: PreviewOwner) {
  return createHash("sha256")
    .update(`${owner.kind}:${owner.id}`)
    .digest("base64url")
    .slice(0, 16);
}

export function buildPreviewOwnerTicketCookieName(owner: PreviewOwner) {
  return `${PREVIEW_TICKET_COOKIE_PREFIX}${buildPreviewOwnerTicketKey(owner)}`;
}

export function isPreviewTicketCookieName(name: string) {
  return name === PREVIEW_TICKET_COOKIE_NAME || name.startsWith(PREVIEW_TICKET_COOKIE_PREFIX);
}
