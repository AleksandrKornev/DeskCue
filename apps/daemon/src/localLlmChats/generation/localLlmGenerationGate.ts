import { AppError } from "#application/errors";

export type LocalLlmGenerationSlotRelease = () => void;

type QueuedGeneration = {
  onAbort: () => void;
  resolve: (release: LocalLlmGenerationSlotRelease | null) => void;
  signal: AbortSignal;
};

/** A bounded, abortable FIFO gate shared by every local runtime generation. */
export class LocalLlmGenerationGate {
  private activeCount = 0;
  private closed = false;
  private readonly queue: QueuedGeneration[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly queueCapacity: number
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new TypeError("Local LLM generation concurrency must be a positive integer.");
    }
    if (!Number.isSafeInteger(queueCapacity) || queueCapacity < 1) {
      throw new TypeError("Local LLM generation queue capacity must be a positive integer.");
    }
  }

  async acquire(signal: AbortSignal): Promise<LocalLlmGenerationSlotRelease | null> {
    if (this.closed || signal.aborted) return null;
    if (this.activeCount < this.concurrency) {
      this.activeCount += 1;
      return this.createRelease();
    }
    if (this.queue.length >= this.queueCapacity) {
      throw new AppError(
        "conflict",
        "Local runtime generation queue is full. Try again after an active response finishes."
      );
    }

    return new Promise((resolve) => {
      const queued: QueuedGeneration = {
        onAbort: () => {
          const index = this.queue.indexOf(queued);
          if (index >= 0) {
            this.queue.splice(index, 1);
            resolve(null);
          }
        },
        resolve,
        signal
      };
      signal.addEventListener("abort", queued.onAbort, { once: true });
      this.queue.push(queued);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const queued of this.queue.splice(0)) {
      queued.signal.removeEventListener("abort", queued.onAbort);
      queued.resolve(null);
    }
  }

  private createRelease(): LocalLlmGenerationSlotRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount = Math.max(0, this.activeCount - 1);
      this.drain();
    };
  }

  private drain() {
    while (!this.closed && this.activeCount < this.concurrency && this.queue.length > 0) {
      const queued = this.queue.shift();
      if (!queued) return;
      queued.signal.removeEventListener("abort", queued.onAbort);
      if (queued.signal.aborted) {
        queued.resolve(null);
        continue;
      }
      this.activeCount += 1;
      queued.resolve(this.createRelease());
    }
  }
}
