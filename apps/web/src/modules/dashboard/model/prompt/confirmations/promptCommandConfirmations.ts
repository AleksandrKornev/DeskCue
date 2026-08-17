import { requestConfirmation } from "@components/ModalDialog";
import type { SendInputOptions } from "@models/promptDelivery";

export function confirmAmbiguousActionDecisionResend(
  decision: NonNullable<SendInputOptions["actionDecision"]>
) {
  const approving = decision === "approve";
  return requestConfirmation({
    cancelLabel: "Cancel",
    confirmLabel: approving ? "Approve again" : "Reject again",
    description: approving
      ? "DeskCue could not confirm whether the connected computer applied this approval. Approving again could affect a newer request."
      : "DeskCue could not confirm whether the connected computer applied this rejection. Rejecting again could affect a newer request.",
    title: approving ? "Approve this request again?" : "Reject this request again?",
    tone: "danger"
  });
}

export function confirmAmbiguousPromptResend() {
  return requestConfirmation({
    cancelLabel: "Cancel",
    confirmLabel: "Send again",
    description:
      "DeskCue could not confirm whether the connected computer received this prompt. Sending it again can create duplicate work.",
    title: "Send this prompt again?",
    tone: "danger"
  });
}

export function withoutReplacementInterrupt(
  options?: SendInputOptions
): SendInputOptions | undefined {
  return options?.replaceRunningPrompt
    ? { ...options, replaceRunningPrompt: false }
    : options;
}
