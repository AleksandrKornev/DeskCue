import type { SendInputOptions } from "@models/promptDelivery";

export const TOUCH_SEND_BLUR_DELAY_MS = 350;

export function shouldSubmitComposerOnEnter(
  value: string,
  modifiers: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  compactViewport: boolean
) {
  // Mobile soft keyboards do not consistently expose Shift+Enter. In the
  // compact chat layout Enter must remain a reliable newline action; the
  // visible send button is the explicit submit control.
  if (compactViewport) {
    return false;
  }

  if (modifiers.shiftKey) {
    return false;
  }

  if (modifiers.ctrlKey || modifiers.metaKey) {
    return true;
  }

  return !/[\r\n]/u.test(value);
}

export function buildSharedSessionTakeoverConfirmation(viewerCount: number, promptText: string) {
  const normalizedPrompt = promptText.trim();
  const promptPreview =
    normalizedPrompt.length > 280 ? `${normalizedPrompt.slice(0, 280)}...` : normalizedPrompt;

  return [
    `This live session is currently open in ${viewerCount} DeskCue clients`,
    "",
    "Current running prompt:",
    promptPreview || "(Prompt text is unavailable.)",
    "",
    "Sending your new prompt from this client will interrupt the current run first",
    "Do you want to continue?"
  ].join("\n");
}

export function getDraftActionDecision(value: string): SendInputOptions["actionDecision"] | undefined {
  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === "y" || normalizedValue === "yes" || normalizedValue === "approve") {
    return "approve";
  }

  if (
    normalizedValue === "n" ||
    normalizedValue === "no" ||
    normalizedValue === "reject" ||
    normalizedValue === "esc" ||
    normalizedValue === "escape"
  ) {
    return "reject";
  }

  return undefined;
}
