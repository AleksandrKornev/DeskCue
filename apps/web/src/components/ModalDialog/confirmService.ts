import type {
  ConfirmationDialogCancellation,
  ConfirmationDialogRequest,
  ConfirmationOptions,
  ConfirmationRequestLifecycle
} from "./types";

export const CONFIRMATION_REQUEST_EVENT = "deskcue:confirmation-request";
export const CONFIRMATION_CANCEL_EVENT = "deskcue:confirmation-cancel";

let nextConfirmationRequestId = 1;
let isConfirmationHostMounted = false;

class PendingConfirmationRequest {
  private settled = false;

  constructor(
    readonly id: number,
    private readonly signal: AbortSignal | undefined,
    private readonly resolvePromise: (confirmed: boolean) => void
  ) {}

  readonly cancel = () => {
    window.dispatchEvent(
      new CustomEvent<ConfirmationDialogCancellation>(CONFIRMATION_CANCEL_EVENT, {
        detail: { id: this.id }
      })
    );

    this.settle(false);
  };

  readonly settle = (confirmed: boolean) => {
    if (this.settled) return;

    this.settled = true;
    this.signal?.removeEventListener("abort", this.cancel);
    this.resolvePromise(confirmed);
  };

  start(options: ConfirmationOptions) {
    this.signal?.addEventListener("abort", this.cancel, { once: true });

    window.dispatchEvent(
      new CustomEvent<ConfirmationDialogRequest>(CONFIRMATION_REQUEST_EVENT, {
        detail: {
          id: this.id,
          options,
          resolve: this.settle
        }
      })
    );
  }
}

export function setConfirmationHostMounted(isMounted: boolean) {
  isConfirmationHostMounted = isMounted;
}

export function requestConfirmation(
  options: ConfirmationOptions,
  lifecycle: ConfirmationRequestLifecycle = {}
) {
  if (!isConfirmationHostMounted || lifecycle.signal?.aborted) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    const requestId = nextConfirmationRequestId;
    const request = new PendingConfirmationRequest(requestId, lifecycle.signal, resolve);

    nextConfirmationRequestId += 1;
    request.start(options);
  });
}
