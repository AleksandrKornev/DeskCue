import type { MutableRefObject } from "react";

type LocalLlmPreviewMutationRequest = {
  isCurrent: () => boolean;
  reject: (reason?: unknown) => void;
  resolve: (value: boolean) => void;
  run: () => Promise<boolean>;
};

export type LocalLlmPreviewMutationQueue = {
  active: LocalLlmPreviewMutationRequest | null;
  pending: LocalLlmPreviewMutationRequest | null;
};

async function runLocalLlmPreviewMutationQueue(
  queueRef: MutableRefObject<LocalLlmPreviewMutationQueue>
) {
  while (queueRef.current.active) {
    const request = queueRef.current.active;

    try {
      request.resolve(request.isCurrent() ? await request.run() : false);
    } catch (error) {
      request.reject(error);
    }

    queueRef.current.active = queueRef.current.pending;
    queueRef.current.pending = null;
  }
}

export function queueLocalLlmPreviewMutation(
  queueRef: MutableRefObject<LocalLlmPreviewMutationQueue>,
  isCurrent: () => boolean,
  run: () => Promise<boolean>
) {
  return new Promise<boolean>((resolve, reject) => {
    const request = { isCurrent, reject, resolve, run };

    if (!queueRef.current.active) {
      queueRef.current.active = request;
      void runLocalLlmPreviewMutationQueue(queueRef);
      return;
    }

    queueRef.current.pending?.resolve(false);
    queueRef.current.pending = request;
  });
}
