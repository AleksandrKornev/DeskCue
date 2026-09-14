import type {
  LmStudioInstalledModel,
  LmStudioPrepareResponse,
  LmStudioServerStartResponse
} from "@deskcue/protocol";
import { AppError } from "#application/errors";
import type { UpdateAdmissionPort } from "#application/update/updateAdmission";

import {
  getLmStudioModelReadiness,
  listLmStudioModels,
  prepareLmStudioModel,
  startLmStudioServer
} from "./lmStudioServer.ts";
import type { LmStudioModelReadiness } from "./lmStudioServer.ts";

type RuntimeOperation<T> = (signal: AbortSignal) => Promise<T>;

type LmStudioRuntimeCoordinatorOptions = {
  concurrency?: number;
  getModelReadiness?: (model: string, signal?: AbortSignal) => Promise<LmStudioModelReadiness>;
  listModels?: (signal?: AbortSignal) => Promise<LmStudioInstalledModel[]>;
  prepareModel?: (
    model: string,
    signal?: AbortSignal,
    startServer?: () => Promise<LmStudioServerStartResponse>
  ) => Promise<LmStudioPrepareResponse>;
  queueCapacity?: number;
  startServer?: (signal?: AbortSignal) => Promise<LmStudioServerStartResponse>;
  updateAdmission?: UpdateAdmissionPort;
};

type QueuedOperation = {
  reject: (error: Error) => void;
  start: (signal: AbortSignal) => Promise<unknown>;
};

class DeferredRuntimeOperation<T> implements QueuedOperation {
  constructor(
    private readonly operation: RuntimeOperation<T>,
    private readonly resolve: (value: T | PromiseLike<T>) => void,
    private readonly rejectOperation: (error: unknown) => void
  ) {}

  reject(error: Error) {
    this.rejectOperation(error);
  }

  start(signal: AbortSignal) {
    const active = Promise.resolve().then(() => this.operation(signal));

    void active.then(this.resolve, this.rejectOperation);

    return active;
  }
}

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_QUEUE_CAPACITY = 16;

function readPositiveInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

/** Owns all mutating LM Studio runtime work for one daemon application. */
export class LmStudioRuntimeCoordinator {
  private activeCount = 0;
  private readonly activeOperations = new Set<Promise<unknown>>();
  private readonly controller = new AbortController();
  private readonly concurrency: number;
  private closePromise: Promise<void> | null = null;
  private readonly getModelReadinessOperation: NonNullable<LmStudioRuntimeCoordinatorOptions["getModelReadiness"]>;
  private listFlight: Promise<LmStudioInstalledModel[]> | null = null;
  private readonly listModelsOperation: NonNullable<LmStudioRuntimeCoordinatorOptions["listModels"]>;
  private readonly prepareFlights = new Map<string, Promise<LmStudioPrepareResponse>>();
  private readonly prepareModelOperation: NonNullable<LmStudioRuntimeCoordinatorOptions["prepareModel"]>;
  private readonly queue: QueuedOperation[] = [];
  private readonly queueCapacity: number;
  private startOperationFlight: Promise<LmStudioServerStartResponse> | null = null;
  private startFlight: Promise<LmStudioServerStartResponse> | null = null;
  private readonly startServerOperation: NonNullable<LmStudioRuntimeCoordinatorOptions["startServer"]>;
  private readonly updateAdmission?: UpdateAdmissionPort;

  constructor(options: LmStudioRuntimeCoordinatorOptions = {}) {
    this.concurrency = readPositiveInteger(options.concurrency, DEFAULT_CONCURRENCY);
    this.queueCapacity = readPositiveInteger(options.queueCapacity, DEFAULT_QUEUE_CAPACITY);
    this.getModelReadinessOperation = options.getModelReadiness ?? ((model, signal) =>
      getLmStudioModelReadiness(model, { signal }));
    this.listModelsOperation = options.listModels ?? ((signal) => listLmStudioModels({ signal }));
    this.prepareModelOperation = options.prepareModel ?? ((model, signal, startServer) =>
      prepareLmStudioModel(model, {
        signal,
        startServer
      }));
    this.startServerOperation = options.startServer ?? ((signal) => startLmStudioServer({ signal }));
    this.updateAdmission = options.updateAdmission;
  }

  getActiveOperationCount() {
    return this.activeCount;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    this.controller.abort(new Error("LM Studio runtime coordinator is closing."));
    const closingError = this.closedError();

    for (const queued of this.queue.splice(0)) queued.reject(closingError);

    this.closePromise = (async () => {
      while (this.activeOperations.size > 0) {
        await Promise.allSettled([...this.activeOperations]);
      }

      this.prepareFlights.clear();
      this.listFlight = null;
      this.startFlight = null;
    })();
    return this.closePromise;
  }

  getModelReadiness(model: string) {
    return this.runBounded((signal) => this.getModelReadinessOperation(model, signal));
  }

  listModels() {
    if (this.listFlight) return this.listFlight;

    const flight = this.runBounded((signal) => this.listModelsOperation(signal));

    this.listFlight = flight;

    void flight.finally(() => {
      if (this.listFlight === flight) this.listFlight = null;
    }).catch(() => {});
    return flight;
  }

  prepareModel(model: string) {
    const normalizedModel = model.trim();
    const flightKey = normalizedModel.replaceAll("\\", "/").toLocaleLowerCase("en-US");
    const existing = this.prepareFlights.get(flightKey);

    if (existing) return existing;

    const flight = this.runBounded((signal) => this.prepareModelOperation(
      normalizedModel,
      signal,
      () => this.runStartOperation(signal)
    ));

    this.prepareFlights.set(flightKey, flight);
    void flight.finally(() => {
      if (this.prepareFlights.get(flightKey) === flight) {
        this.prepareFlights.delete(flightKey);
      }
    }).catch(() => {});
    return flight;
  }

  startServer() {
    if (this.startFlight) return this.startFlight;

    const flight = this.runBounded((signal) => this.runStartOperation(signal));

    this.startFlight = flight;

    void flight.finally(() => {
      if (this.startFlight === flight) this.startFlight = null;
    }).catch(() => {});
    return flight;
  }

  private closedError() {
    return new AppError("runtime_unavailable", "LM Studio runtime operations are shutting down.");
  }

  private runStartOperation(signal: AbortSignal) {
    if (this.startOperationFlight) return this.startOperationFlight;

    const operation = this.startServerOperation(signal);

    this.startOperationFlight = operation;

    void operation.finally(() => {
      if (this.startOperationFlight === operation) this.startOperationFlight = null;
    }).catch(() => {});
    return operation;
  }

  private runBounded<T>(operation: RuntimeOperation<T>): Promise<T> {
    return this.updateAdmission
      ? this.updateAdmission.run("lm_studio", () => this.runBoundedAdmitted(operation))
      : this.runBoundedAdmitted(operation);
  }

  private runBoundedAdmitted<T>(operation: RuntimeOperation<T>): Promise<T> {
    if (this.controller.signal.aborted) return Promise.reject(this.closedError());

    if (this.activeCount >= this.concurrency && this.queue.length >= this.queueCapacity) {
      return Promise.reject(new AppError(
        "conflict",
        "LM Studio runtime operation queue is full. Try again after the current operation finishes."
      ));
    }

    return new Promise<T>((resolve, reject) => {
      const queued = new DeferredRuntimeOperation(operation, resolve, reject);

      if (this.activeCount < this.concurrency) this.startQueuedOperation(queued);
      else this.queue.push(queued);
    });
  }

  private startQueuedOperation(operation: QueuedOperation) {
    if (this.controller.signal.aborted) {
      operation.reject(this.closedError());
      return;
    }

    this.activeCount += 1;
    const active = operation.start(this.controller.signal);

    this.activeOperations.add(active);
    void active.then(
      () => this.finishQueuedOperation(active),
      () => this.finishQueuedOperation(active)
    );
  }

  private finishQueuedOperation(operation: Promise<unknown>) {
    this.activeOperations.delete(operation);
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.drainQueue();
  }

  private drainQueue() {
    while (!this.controller.signal.aborted && this.activeCount < this.concurrency) {
      const queued = this.queue.shift();

      if (!queued) return;

      this.startQueuedOperation(queued);
    }
  }
}
