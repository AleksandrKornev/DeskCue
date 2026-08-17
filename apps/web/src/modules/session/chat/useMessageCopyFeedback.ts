import { useEffect, useRef, useState } from "react";

import { copyText } from "@lib/clipboard";

import type { CopyFeedback } from "./types";

export function useMessageCopyFeedback() {
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
  }, []);

  const handleCopyMessage = async (messageId: string, text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText) {
      return;
    }

    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    try {
      const copied = await copyText(normalizedText);
      setCopyFeedback({
        messageId,
        status: copied ? "copied" : "failed"
      });
    } catch {
      setCopyFeedback({
        messageId,
        status: "failed"
      });
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback((current) => (current?.messageId === messageId ? null : current));
      copyFeedbackTimerRef.current = null;
    }, 1800);
  };

  return {
    copyFeedback,
    handleCopyMessage
  };
}
