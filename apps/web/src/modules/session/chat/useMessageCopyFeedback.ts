import { useCallback, useEffect, useRef, useState } from "react";

import { copyText } from "@lib/clipboard";

import type { CopyFeedback } from "./types";

type OwnedCopyFeedback = Exclude<CopyFeedback, null> & {
  ownerKey: string;
};

export function useMessageCopyFeedback(ownerKey: string) {
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const copyOperationRef = useRef(0);
  const [ownedCopyFeedback, setOwnedCopyFeedback] = useState<OwnedCopyFeedback | null>(null);
  const copyFeedback = ownedCopyFeedback?.ownerKey === ownerKey
    ? ownedCopyFeedback
    : null;

  useEffect(() => {
    copyOperationRef.current += 1;

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }

    setOwnedCopyFeedback(null);

    return () => {
      copyOperationRef.current += 1;

      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
        copyFeedbackTimerRef.current = null;
      }
    };
  }, [ownerKey]);

  const handleCopyMessage = useCallback(async (messageId: string, text: string) => {
    const normalizedText = text.trim();

    if (!normalizedText) {
      return;
    }

    const copyOperation = copyOperationRef.current + 1;

    copyOperationRef.current = copyOperation;

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }

    setOwnedCopyFeedback(null);

    let status: "copied" | "failed";

    try {
      const copied = await copyText(normalizedText);

      status = copied ? "copied" : "failed";
    } catch {
      status = "failed";
    }

    if (copyOperationRef.current !== copyOperation) return;

    setOwnedCopyFeedback({ messageId, ownerKey, status });

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      if (copyOperationRef.current !== copyOperation) return;

      setOwnedCopyFeedback(null);
      copyFeedbackTimerRef.current = null;
    }, 1800);
  }, [ownerKey]);

  return {
    copyFeedback,
    handleCopyMessage
  };
}
