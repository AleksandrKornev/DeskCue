import { AppError } from "#application/errors";

type QueuedDelivery = {
  reject: (error: Error) => void;
  run: () => void;
};

export class NotificationDeliveryAdmissionError extends AppError {
  constructor(code: "conflict" | "runtime_unavailable", message: string) {
    super(code, message);
  }
}

/** Global bounded admission for every provider delivery owned by one service. */
export class NotificationDeliveryGate {
  private activeCount = 0;
  private readonly activeOperations = new Set<Promise<unknown>>();
  private readonly controller = new AbortController();
  private readonly queue: QueuedDelivery[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly queueCapacity: number
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new TypeError("Notification delivery concurrency must be a positive integer.");
    }
    if (!Number.isSafeInteger(queueCapacity) || queueCapacity < 1) {
      throw new TypeError("Notification delivery queue capacity must be a positive integer.");
    }
  }

  beginClosing() {
    if (this.controller.signal.aborted) return;
    this.controller.abort(new Error("Notification delivery service is closing."));
    const error = this.closedError();
    for (const queued of this.queue.splice(0)) queued.reject(error);
  }

  async drain() {
    while (this.activeOperations.size > 0) {
      await Promise.allSettled([...this.activeOperations]);
    }
  }

  run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.controller.signal.aborted) return Promise.reject(this.closedError());
    if (this.activeCount >= this.concurrency && this.queue.length >= this.queueCapacity) {
      return Promise.reject(new NotificationDeliveryAdmissionError(
        "conflict",
        "Notification delivery queue is full. The durable outbox will retry later."
      ));
    }

    return new Promise<T>((resolve, reject) => {
      const run = () => {
        if (this.controller.signal.aborted) {
          reject(this.closedError());
          return;
        }
        this.activeCount += 1;
        const active = Promise.resolve().then(() => operation(this.controller.signal));
        this.activeOperations.add(active);
        void active.then(resolve, reject).finally(() => {
          this.activeOperations.delete(active);
          this.activeCount = Math.max(0, this.activeCount - 1);
          this.drainQueue();
        });
      };
      if (this.activeCount < this.concurrency) run();
      else this.queue.push({ reject, run });
    });
  }

  private closedError() {
    return new NotificationDeliveryAdmissionError(
      "runtime_unavailable",
      "Notification delivery service is shutting down."
    );
  }

  private drainQueue() {
    while (!this.controller.signal.aborted && this.activeCount < this.concurrency) {
      const queued = this.queue.shift();
      if (!queued) return;
      queued.run();
    }
  }
}
