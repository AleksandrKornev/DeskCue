import { PREVIEW_PROXY_LIMITS } from "../previewProxyLimits.ts";

export type PreviewRewriteAdmissionRejection = "aborted" | "closed" | "queue-full";

export type PreviewRewriteAdmissionResult =
  | { accepted: true; release: () => void }
  | { accepted: false; reason: PreviewRewriteAdmissionRejection };

type QueuedRewrite = {
  abort?: () => void;
  resolve: (result: PreviewRewriteAdmissionResult) => void;
  signal?: AbortSignal;
};

function rejected(reason: PreviewRewriteAdmissionRejection): PreviewRewriteAdmissionResult {
  return { accepted: false, reason };
}

/**
 * Bounds the memory-heavy Next application bundle rewrite separately from the
 * general HTTP proxy admission. Queued upstream responses remain paused and
 * therefore apply TCP backpressure instead of collecting their bodies in RAM.
 */
export class PreviewRewriteAdmission {
  private active = 0;
  private closed = false;
  private readonly queue: QueuedRewrite[] = [];

  acquire(signal?: AbortSignal): Promise<PreviewRewriteAdmissionResult> {
    if (signal?.aborted) return Promise.resolve(rejected("aborted"));
    if (this.closed) return Promise.resolve(rejected("closed"));
    if (this.active < PREVIEW_PROXY_LIMITS.maxConcurrentJavaScriptRewrites) {
      return Promise.resolve(this.createLease());
    }
    if (this.queue.length >= PREVIEW_PROXY_LIMITS.maxQueuedJavaScriptRewrites) {
      return Promise.resolve(rejected("queue-full"));
    }

    return new Promise((resolve) => {
      const queued: QueuedRewrite = { resolve, signal };
      if (signal) {
        queued.abort = () => {
          const index = this.queue.indexOf(queued);
          if (index >= 0) this.queue.splice(index, 1);
          resolve(rejected("aborted"));
        };
        signal.addEventListener("abort", queued.abort, { once: true });
      }
      this.queue.push(queued);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const queued of this.queue.splice(0)) {
      this.detachAbort(queued);
      queued.resolve(rejected("closed"));
    }
  }

  readSnapshot() {
    return { active: this.active, queued: this.queue.length, closed: this.closed };
  }

  private createLease(): PreviewRewriteAdmissionResult {
    this.active += 1;
    let released = false;
    return {
      accepted: true,
      release: () => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
        this.drain();
      }
    };
  }

  private drain() {
    while (
      !this.closed &&
      this.active < PREVIEW_PROXY_LIMITS.maxConcurrentJavaScriptRewrites &&
      this.queue.length > 0
    ) {
      const queued = this.queue.shift();
      if (!queued) return;
      this.detachAbort(queued);
      if (queued.signal?.aborted) queued.resolve(rejected("aborted"));
      else queued.resolve(this.createLease());
    }
  }

  private detachAbort(queued: QueuedRewrite) {
    if (queued.signal && queued.abort) {
      queued.signal.removeEventListener("abort", queued.abort);
    }
  }
}
