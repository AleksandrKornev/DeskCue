import { AppError } from "../errors.ts";

export type UpdateAdmissionPort = {
  assertOpen: () => void;
  run<T>(kind: UpdateOperationKind, operation: () => Promise<T>): Promise<T>;
};

export type UpdateOperationKind =
  | "local_llm"
  | "lm_studio"
  | "managed_session"
  | "manual_command"
  | "source_agent";

export type UpdateAdmissionDrainLease = {
  release: () => void;
};

export class UpdateAdmission implements UpdateAdmissionPort {
  private readonly activeCounts = new Map<UpdateOperationKind, number>();
  private draining = false;

  beginDrain(): UpdateAdmissionDrainLease {
    if (this.draining) {
      throw new AppError("conflict", "DeskCue is already preparing to install an update.");
    }

    this.draining = true;
    let released = false;

    return {
      release: () => {
        if (released) return;

        released = true;
        this.draining = false;
      }
    };
  }

  assertOpen() {
    if (this.draining) {
      throw new AppError(
        "conflict",
        "DeskCue is preparing to install an update. Retry after the update is cancelled or completed."
      );
    }
  }

  getActiveCount(kind: UpdateOperationKind) {
    return this.activeCounts.get(kind) ?? 0;
  }

  isDraining() {
    return this.draining;
  }

  run<T>(kind: UpdateOperationKind, operation: () => Promise<T>): Promise<T> {
    try {
      this.assertOpen();
    } catch (error) {
      return Promise.reject(error);
    }

    this.activeCounts.set(kind, this.getActiveCount(kind) + 1);

    let result: Promise<T>;
    try {
      result = operation();
    } catch (error) {
      this.releaseOperation(kind);
      return Promise.reject(error);
    }

    return result.finally(() => this.releaseOperation(kind));
  }

  private releaseOperation(kind: UpdateOperationKind) {
    const nextCount = Math.max(0, this.getActiveCount(kind) - 1);

    if (nextCount === 0) {
      this.activeCounts.delete(kind);
    } else {
      this.activeCounts.set(kind, nextCount);
    }
  }
}
