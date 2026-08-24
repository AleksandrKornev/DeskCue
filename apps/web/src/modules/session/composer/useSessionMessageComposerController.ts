import {
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from "react";

import { requestConfirmation } from "@components/ModalDialog";

import {
  blurComposerField,
  buildSharedSessionTakeoverConfirmation,
  getDraftActionDecision,
  normalizeComposerNotice,
  shouldShowComposerHint,
  shouldSubmitComposerOnEnter,
  TOUCH_SEND_BLUR_DELAY_MS
} from "./helpers";
import type { SessionMessageComposerProps } from "./types";

export function useSessionMessageComposerController({
  activePromptText,
  actionRequest,
  canSendInput,
  compactViewport = false,
  draftScopeKey,
  isInterruptingPrompt,
  isPromptInFlight,
  isPromptQueued = false,
  mode,
  onInterruptPrompt,
  onSendInput,
  sharedSessionHint,
  viewerCount = 0
}: SessionMessageComposerProps) {
  const [hasDraft, setHasDraft] = useState(false);
  const [pendingActionDecision, setPendingActionDecision] = useState<"approve" | "reject" | null>(null);
  const [isComposerFieldFocused, setIsComposerFieldFocused] = useState(false);
  const composerInputId = useId();

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const handledTouchSendPointerRef = useRef(false);
  const visibleActionRequest = actionRequest;
  const isActionDecisionPending = Boolean(actionRequest);
  const isActionDecisionDisabled = Boolean(pendingActionDecision) || !canSendInput || isInterruptingPrompt;

  const canReplaceRunningPrompt =
    canSendInput &&
    !isActionDecisionPending &&
    isPromptInFlight;

  const shouldSubmitReplacement = canReplaceRunningPrompt && hasDraft;
  const canSubmitDraft =
    canSendInput &&
    !isInterruptingPrompt &&
    (!isPromptInFlight || isActionDecisionPending || shouldSubmitReplacement);

  const buttonActsAsInterrupt = isPromptInFlight && !isActionDecisionPending && !shouldSubmitReplacement;
  const sendButtonLabel = shouldSubmitReplacement
    ? isPromptQueued
      ? "Replace queued message"
      : "Interrupt current prompt and send message"
    : "Send message";

  const interruptButtonLabel = isPromptQueued ? "Cancel queued message" : "Interrupt prompt";
  const normalizedSharedSessionHint = normalizeComposerNotice(sharedSessionHint);
  const shouldShowSharedSessionHint = shouldShowComposerHint({
    canSendInput,
    sharedSessionHint: normalizedSharedSessionHint
  });
  const sharedSessionHintText =
    normalizedSharedSessionHint && compactViewport && viewerCount > 1
      ? `${viewerCount} DeskCue clients open. Sending may interrupt the current run`
      : normalizedSharedSessionHint;

  const actions = {
    async confirmSharedSessionTakeover() {
      if (!shouldSubmitReplacement) return true;
      if (viewerCount <= 1) return true;

      return requestConfirmation({
        confirmLabel: "Interrupt and send",
        description: buildSharedSessionTakeoverConfirmation(viewerCount, activePromptText ?? ""),
        title: "Interrupt current prompt?",
        tone: "danger"
      });
    },
    handleChatSendButtonClick() {
      if (handledTouchSendPointerRef.current) {
        handledTouchSendPointerRef.current = false;
        return;
      }

      if (buttonActsAsInterrupt && !isInterruptingPrompt && canSendInput) {
        onInterruptPrompt();
        return;
      }

      void actions.submitDraft();
    },
    handleComposerFieldBlur() {
      setIsComposerFieldFocused(false);
    },
    handleComposerFieldFocus() {
      setIsComposerFieldFocused(true);
    },
    handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
      if (event.key !== "Enter") return;
      if (event.nativeEvent.isComposing) return;
      if (!shouldSubmitComposerOnEnter(event.currentTarget.value, event, compactViewport)) return;
      if (!event.currentTarget.value.trim() || !canSubmitDraft) return;

      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    },
    handleSendPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
      if (!canSubmitDraft) return;
      if (buttonActsAsInterrupt) return;

      event.preventDefault();

      if (event.pointerType === "touch") {
        handledTouchSendPointerRef.current = true;
        void actions.submitDraft({ blurDelayMs: TOUCH_SEND_BLUR_DELAY_MS });
        return;
      }

      const field = mode === "chat" ? textAreaRef.current : textInputRef.current;

      blurComposerField(field);
    },
    handleSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      void actions.submitDraft();
    },
    async sendActionDecision(decision: "approve" | "reject") {
      if (!canSendInput || isInterruptingPrompt) return;

      const field = mode === "chat" ? textAreaRef.current : textInputRef.current;

      blurComposerField(field);

      if (field) field.value = "";
      setHasDraft(false);
      setPendingActionDecision(decision);

      const sent = await onSendInput(decision === "approve" ? "y" : "esc", {
        actionDecision: decision
      });

      if (!sent) {
        setPendingActionDecision(null);
        setHasDraft(false);
      }
    },
    async submitDraft(options?: { blurDelayMs?: number }) {
      const field = mode === "chat" ? textAreaRef.current : textInputRef.current;
      const nextDraft = field?.value.trim() ?? "";

      if (!nextDraft || !canSubmitDraft) return;
      if (!(await actions.confirmSharedSessionTakeover())) return;

      blurComposerField(field, options?.blurDelayMs);
      if (field) field.value = "";
      setHasDraft(false);

      const actionDecision = isActionDecisionPending ? getDraftActionDecision(nextDraft) : undefined;
      const sent = await onSendInput(nextDraft, {
        actionDecision,
        replaceRunningPrompt: shouldSubmitReplacement
      });

      if (!sent) {
        if (field) field.value = nextDraft;
        setHasDraft(true);
        return;
      }

      blurComposerField(field);
    },
    syncHasDraft(nextValue: string) {
      const nextHasDraft = nextValue.trim().length > 0;

      setHasDraft((current) => (current === nextHasDraft ? current : nextHasDraft));
    }
  };

  useEffect(() => {
    const field = mode === "chat" ? textAreaRef.current : textInputRef.current;

    if (field) field.value = "";

    setHasDraft(false);

    const draftRestoration = {
      sync() {
        const restoredField = mode === "chat" ? textAreaRef.current : textInputRef.current;

        setHasDraft(Boolean(restoredField?.value.trim()));
      }
    };

    const frame = window.requestAnimationFrame(draftRestoration.sync);
    const restoredDraftTimer = window.setTimeout(draftRestoration.sync, 250);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(restoredDraftTimer);
    };
  }, [draftScopeKey, mode]);

  useEffect(() => {
    if (!actionRequest) setPendingActionDecision(null);
  }, [actionRequest]);

  return {
    buttonActsAsInterrupt,
    canSubmitDraft,
    composerInputId,
    handleChatSendButtonClick: actions.handleChatSendButtonClick,
    handleComposerFieldBlur: actions.handleComposerFieldBlur,
    handleComposerFieldFocus: actions.handleComposerFieldFocus,
    handleKeyDown: actions.handleKeyDown,
    handleSendPointerDown: actions.handleSendPointerDown,
    handleSubmit: actions.handleSubmit,
    hasDraft,
    interruptButtonLabel,
    isActionDecisionDisabled,
    isComposerFieldFocused,
    sendActionDecision: actions.sendActionDecision,
    sendButtonLabel,
    sharedSessionHintText,
    shouldShowSharedSessionHint,
    shouldSubmitReplacement,
    syncHasDraft: actions.syncHasDraft,
    textAreaRef,
    textInputRef,
    visibleActionRequest
  };
}
