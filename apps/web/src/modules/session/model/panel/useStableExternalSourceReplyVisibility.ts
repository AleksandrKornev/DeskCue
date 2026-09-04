import { useEffect, useState } from "react";

import { EXTERNAL_WAIT_INACTIVE_CONFIRMATION_DELAY_MS } from "./constants";

type StableExternalSourceReplyVisibilityOptions = {
  hasExternalSourceReply: boolean;
  resetKey: string;
  terminalConfirmed: boolean;
};

type StableExternalSourceReplyVisibilityState = {
  resetKey: string;
  visible: boolean;
};

export function useStableExternalSourceReplyVisibility({
  hasExternalSourceReply,
  resetKey,
  terminalConfirmed
}: StableExternalSourceReplyVisibilityOptions) {
  const [state, setState] = useState<StableExternalSourceReplyVisibilityState>({
    resetKey,
    visible: hasExternalSourceReply
  });
  const isCurrentTurn = state.resetKey === resetKey;
  const isVisible =
    !terminalConfirmed &&
    (hasExternalSourceReply || (isCurrentTurn && state.visible));

  useEffect(() => {
    if (!isCurrentTurn) {
      setState({ resetKey, visible: hasExternalSourceReply });

      return;
    }

    if (terminalConfirmed) {
      if (state.visible) setState({ resetKey, visible: false });

      return;
    }

    if (state.visible) {
      if (hasExternalSourceReply) return;

      const timer = window.setTimeout(
        () => setState({ resetKey, visible: false }),
        EXTERNAL_WAIT_INACTIVE_CONFIRMATION_DELAY_MS
      );

      return () => window.clearTimeout(timer);
    }

    if (hasExternalSourceReply) setState({ resetKey, visible: true });
  }, [hasExternalSourceReply, isCurrentTurn, resetKey, state.visible, terminalConfirmed]);

  return isVisible;
}
