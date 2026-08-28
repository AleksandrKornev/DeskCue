import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";

import { ConfirmDialog } from "./ConfirmDialog";
import {
  CONFIRMATION_CANCEL_EVENT,
  CONFIRMATION_REQUEST_EVENT,
  setConfirmationHostMounted
} from "./confirmService";
import type {
  ConfirmationDialogCancellation,
  ConfirmationDialogRequest
} from "./types";

export function ConfirmDialogHost() {
  const [activeRequest, setActiveRequest] = useState<ConfirmationDialogRequest | null>(null);
  const activeRequestRef = useRef<ConfirmationDialogRequest | null>(null);

  const settleActiveRequest = useCallback((confirmed: boolean) => {
    const request = activeRequestRef.current;

    if (!request) {
      return;
    }

    activeRequestRef.current = null;
    setActiveRequest(null);
    request.resolve(confirmed);
  }, []);

  const handleConfirmationRequest = useCallback((event: Event) => {
    const request = (event as CustomEvent<ConfirmationDialogRequest>).detail;

    activeRequestRef.current?.resolve(false);

    activeRequestRef.current = request;
    setActiveRequest(request);
  }, []);

  const handleConfirmationCancellation = useCallback((event: Event) => {
    const cancellation = (event as CustomEvent<ConfirmationDialogCancellation>).detail;

    if (activeRequestRef.current?.id !== cancellation.id) return;

    settleActiveRequest(false);
  }, [settleActiveRequest]);

  useEffect(() => {
    setConfirmationHostMounted(true);

    window.addEventListener(CONFIRMATION_CANCEL_EVENT, handleConfirmationCancellation);
    window.addEventListener(CONFIRMATION_REQUEST_EVENT, handleConfirmationRequest);

    return () => {
      setConfirmationHostMounted(false);
      window.removeEventListener(CONFIRMATION_CANCEL_EVENT, handleConfirmationCancellation);
      window.removeEventListener(CONFIRMATION_REQUEST_EVENT, handleConfirmationRequest);
      activeRequestRef.current?.resolve(false);
      activeRequestRef.current = null;
    };
  }, [handleConfirmationCancellation, handleConfirmationRequest]);

  return (
    <ConfirmDialog
      cancelLabel={activeRequest?.options.cancelLabel}
      confirmLabel={activeRequest?.options.confirmLabel ?? "Confirm"}
      description={activeRequest?.options.description}
      isOpen={Boolean(activeRequest)}
      title={activeRequest?.options.title ?? "Confirm action"}
      tone={activeRequest?.options.tone}
      onCancel={() => settleActiveRequest(false)}
      onConfirm={() => settleActiveRequest(true)}
    />
  );
}
