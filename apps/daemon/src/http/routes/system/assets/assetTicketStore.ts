import { randomUUID } from "node:crypto";

import type { LocalAssetFileIdentity } from "./assetFileResponse.ts";

export type AssetTicket = {
  agentSessionId?: string;
  download: boolean;
  expiresAt: number;
  fileIdentity: LocalAssetFileIdentity;
  kind: "file" | "local_image";
  managedSessionId?: string;
  maxBytes?: number;
  path: string;
  requestedPath: string;
  workspaceId?: string;
};

/** Ephemeral tickets are scoped to one installed HTTP application lifecycle. */
export class AssetTicketStore {
  private readonly tickets = new Map<string, AssetTicket>();

  constructor(
    private readonly maxTickets: number,
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  create(ticket: Omit<AssetTicket, "expiresAt">) {
    this.prune();
    const id = randomUUID();
    const value = { ...ticket, expiresAt: this.now() + this.ttlMs };

    this.tickets.set(id, value);

    this.prune();
    return { id, ticket: value };
  }

  read(id: string) {
    const ticket = this.tickets.get(id);

    if (!ticket || ticket.expiresAt < this.now()) {
      this.tickets.delete(id);
      return null;
    }

    return ticket;
  }

  private prune() {
    const now = this.now();

    for (const [id, ticket] of this.tickets) {
      if (ticket.expiresAt < now) this.tickets.delete(id);
    }

    const overflow = this.tickets.size - this.maxTickets;

    if (overflow <= 0) return;

    for (const id of Array.from(this.tickets.keys()).slice(0, overflow)) {
      this.tickets.delete(id);
    }
  }
}
