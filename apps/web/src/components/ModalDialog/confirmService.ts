import type {
  ConfirmationDialogRequest,
  ConfirmationOptions
} from "./types";

export const CONFIRMATION_REQUEST_EVENT = "deskcue:confirmation-request";

let nextConfirmationRequestId = 1;
let isConfirmationHostMounted = false;

export function setConfirmationHostMounted(isMounted: boolean) {
  isConfirmationHostMounted = isMounted;
}

export function requestConfirmation(options: ConfirmationOptions) {
  if (!isConfirmationHostMounted) {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    const requestId = nextConfirmationRequestId;
    nextConfirmationRequestId += 1;

    window.dispatchEvent(
      new CustomEvent<ConfirmationDialogRequest>(CONFIRMATION_REQUEST_EVENT, {
        detail: {
          id: requestId,
          options,
          resolve
        }
      })
    );
  });
}
