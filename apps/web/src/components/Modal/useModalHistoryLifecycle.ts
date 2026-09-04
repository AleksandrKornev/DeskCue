import { useEffect, useRef } from "react";

import {
  createModalHistoryMarker,
  createModalPopStateHandler,
  readHistoryState,
  registerModalHistoryMarker,
  requestInactiveModalHistoryCleanup,
  unregisterModalHistoryMarker
} from "./helpers";
import { isModalEntryTop } from "./useModalFocusLifecycle";

type ModalHistoryLifecycleOptions = {
  enabled: boolean;
  historyId: string;
  isOpen?: boolean;
  modalEntryId: symbol;
  onCloseRef: { current: () => void };
};

export function useModalHistoryLifecycle({
  enabled,
  historyId,
  isOpen = true,
  modalEntryId,
  onCloseRef
}: ModalHistoryLifecycleOptions) {
  const historyEntryActiveRef = useRef(false);

  useEffect(() => {
    if (!isOpen || !enabled) return;

    const marker = createModalHistoryMarker(historyId);

    if (readHistoryState().deskCueModal !== marker) {
      window.history.pushState({ ...readHistoryState(), deskCueModal: marker }, "");
    }

    registerModalHistoryMarker(marker);
    historyEntryActiveRef.current = true;

    const handlePopState = createModalPopStateHandler(
      historyEntryActiveRef,
      onCloseRef,
      marker,
      () => isModalEntryTop(modalEntryId)
    );

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      unregisterModalHistoryMarker(marker);
      if (
        historyEntryActiveRef.current &&
        readHistoryState().deskCueModal === marker
      ) {
        historyEntryActiveRef.current = false;
        queueMicrotask(() => {
          if (
            !historyEntryActiveRef.current &&
            readHistoryState().deskCueModal === marker
          ) {
            requestInactiveModalHistoryCleanup();
          }
        });
      }
    };
  }, [enabled, historyId, isOpen, modalEntryId, onCloseRef]);
}
