import { PREVIEW_PROXY_LIMITS } from "../previewProxyLimits.ts";
import type { PreviewOwner } from "../previewTargetResolver.ts";

export type PreviewAdmissionKind = "http" | "websocket";
export type PreviewAdmissionRejection = "closed" | "global" | "owner" | "viewer";

export type PreviewAdmissionResult =
  | { accepted: true; release: () => void }
  | { accepted: false; reason: PreviewAdmissionRejection };

type AdmissionCounters = {
  active: number;
  owners: Map<string, number>;
  viewers: Map<string, number>;
};

type AdmissionLimits = {
  global: number;
  perOwner: number;
  perViewer: number;
};

function createCounters(): AdmissionCounters {
  return { active: 0, owners: new Map(), viewers: new Map() };
}

function readLimits(kind: PreviewAdmissionKind): AdmissionLimits {
  return kind === "http"
    ? {
      global: PREVIEW_PROXY_LIMITS.maxConcurrentRequests,
      perOwner: PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerOwner,
      perViewer: PREVIEW_PROXY_LIMITS.maxConcurrentRequestsPerViewer
    }
    : {
      global: PREVIEW_PROXY_LIMITS.maxConcurrentWebSockets,
      perOwner: PREVIEW_PROXY_LIMITS.maxConcurrentWebSocketsPerOwner,
      perViewer: PREVIEW_PROXY_LIMITS.maxConcurrentWebSocketsPerViewer
    };
}

function increment(values: Map<string, number>, key: string) {
  values.set(key, (values.get(key) ?? 0) + 1);
}

function decrement(values: Map<string, number>, key: string) {
  const next = (values.get(key) ?? 0) - 1;
  if (next <= 0) values.delete(key);
  else values.set(key, next);
}

/**
 * Owns Preview admission for one daemon instance. Per-scope caps prevent one
 * chat or browser from consuming the complete global proxy budget.
 */
export class PreviewProxyAdmission {
  private readonly http = createCounters();
  private readonly websocket = createCounters();
  private closed = false;

  tryAcquire(
    kind: PreviewAdmissionKind,
    owner: PreviewOwner,
    viewerKey: string
  ): PreviewAdmissionResult {
    if (this.closed) return { accepted: false, reason: "closed" };
    const counters = kind === "http" ? this.http : this.websocket;
    const limits = readLimits(kind);
    const ownerKey = `${owner.kind}\u0000${owner.id}`;
    const scopedViewerKey = viewerKey;

    if ((counters.viewers.get(scopedViewerKey) ?? 0) >= limits.perViewer) {
      return { accepted: false, reason: "viewer" };
    }
    if ((counters.owners.get(ownerKey) ?? 0) >= limits.perOwner) {
      return { accepted: false, reason: "owner" };
    }
    if (counters.active >= limits.global) {
      return { accepted: false, reason: "global" };
    }

    counters.active += 1;
    increment(counters.owners, ownerKey);
    increment(counters.viewers, scopedViewerKey);
    let released = false;
    return {
      accepted: true,
      release: () => {
        if (released) return;
        released = true;
        counters.active = Math.max(0, counters.active - 1);
        decrement(counters.owners, ownerKey);
        decrement(counters.viewers, scopedViewerKey);
      }
    };
  }

  readSnapshot() {
    return {
      activeHttpRequests: this.http.active,
      activeWebSockets: this.websocket.active,
      activeHttpOwners: this.http.owners.size,
      activeHttpViewers: this.http.viewers.size,
      activeWebSocketOwners: this.websocket.owners.size,
      activeWebSocketViewers: this.websocket.viewers.size,
      closed: this.closed
    };
  }

  close() {
    this.closed = true;
  }
}
