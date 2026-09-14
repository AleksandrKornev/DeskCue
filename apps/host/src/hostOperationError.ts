export class HostOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "HostOperationError";
  }
}
