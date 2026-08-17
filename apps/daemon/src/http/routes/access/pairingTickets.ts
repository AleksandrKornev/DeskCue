import { randomBytes } from "node:crypto";

import { logger } from "#infrastructure/logging/logger";

type PairingTicket = {
  code: string;
  createdAt: number;
  expiresAt: number;
};

type PairingTicketStatus = "active" | "used" | "expired_or_invalid";

const PAIRING_TICKET_TTL_MS = 5 * 60 * 1000;
const MAX_PAIRING_TICKETS = 50;
const PAIRING_ATTEMPT_WINDOW_MS = 60 * 1000;
const MAX_PAIRING_ATTEMPTS_PER_WINDOW = 30;
const MAX_PAIRING_ATTEMPT_BUCKETS = 2_048;

type PairingAttemptBucket = {
  count: number;
  resetAt: number;
};

export class PairingTickets {
  private readonly tickets = new Map<string, PairingTicket>();
  private readonly usedTickets = new Map<string, number>();

  create() {
    this.pruneExpired();
    this.pruneOldest();
    this.pruneUsed();

    const code = randomBytes(18).toString("base64url");
    const now = Date.now();
    this.tickets.set(code, {
      code,
      createdAt: now,
      expiresAt: now + PAIRING_TICKET_TTL_MS
    });
    return code;
  }

  consume(code: string) {
    const ticket = this.tickets.get(code);
    this.tickets.delete(code);

    const valid = Boolean(ticket && ticket.expiresAt >= Date.now());
    if (valid && ticket) {
      this.usedTickets.set(code, ticket.expiresAt);
    }

    return valid;
  }

  status(code: string): PairingTicketStatus {
    this.pruneExpired();
    this.pruneUsed();

    if (this.tickets.has(code)) {
      return "active";
    }

    if (this.usedTickets.has(code)) {
      return "used";
    }

    return "expired_or_invalid";
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [code, ticket] of this.tickets.entries()) {
      if (ticket.expiresAt < now) {
        this.tickets.delete(code);
      }
    }
  }

  private pruneOldest() {
    while (this.tickets.size >= MAX_PAIRING_TICKETS) {
      const oldestCode = this.tickets.keys().next().value;
      if (!oldestCode) {
        return;
      }

      this.tickets.delete(oldestCode);
      logger.warn("Oldest pairing ticket evicted after reaching active ticket limit", {
        activeTickets: this.tickets.size,
        maxActiveTickets: MAX_PAIRING_TICKETS
      });
    }
  }

  private pruneUsed() {
    const now = Date.now();
    for (const [code, expiresAt] of this.usedTickets.entries()) {
      if (expiresAt < now) {
        this.usedTickets.delete(code);
      }
    }
  }
}

export class PairingAttemptLimiter {
  private readonly buckets = new Map<string, PairingAttemptBucket>();

  take(key: string) {
    const now = Date.now();
    this.pruneExpired(now);
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.pruneOldest();
      this.buckets.set(key, {
        count: 1,
        resetAt: now + PAIRING_ATTEMPT_WINDOW_MS
      });
      return true;
    }

    if (bucket.count >= MAX_PAIRING_ATTEMPTS_PER_WINDOW) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  private pruneExpired(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  private pruneOldest() {
    while (this.buckets.size >= MAX_PAIRING_ATTEMPT_BUCKETS) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey === undefined) return;
      this.buckets.delete(oldestKey);
    }
  }
}
