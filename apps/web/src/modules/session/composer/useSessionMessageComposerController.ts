import {
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  SubmitEvent
} from "react";

import { requestConfirmation } from "@components/ModalDialog";

import { getComposerConnectionNotice, isComposerTransportAvailable } from "./connection";
import {
  clearComposerDraft,
  isComposerDraftRevisionCurrent,
  readComposerDraft,
  rememberComposerDraft,
  subscribeComposerDraft
} from "./draftStore";
import {
  blurComposerField,
  buildSharedSessionTakeoverConfirmation,
  getDraftActionDecision,
  normalizeComposerNotice,
  shouldShowComposerHint,
  shouldSubmitComposerOnEnter,
  TOUCH_SEND_BLUR_DELAY_MS
} from "./helpers";
import { syncComposerSubmissionLifecycle } from "./submissionLifecycle";
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
  liveUpdatesConnection,
  mode,
  onInterruptPrompt,
  onSendInput,
  sharedSessionHint,
  viewerCount = 0
}: SessionMessageComposerProps) {
  const [hasDraft, setHasDraft] = useState(() => Boolean(readComposerDraft(draftScopeKey).trim()));
  const [pendingActionDecision, setPendingActionDecision] = useState<"approve" | "reject" | null>(null);
  const [isComposerFieldFocused, setIsComposerFieldFocused] = useState(false);
  const composerInputId = useId();

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const handledTouchSendPointerRef = useRef(false);
  const draftRestorationGenerationRef = useRef(0);
  const visibleActionRequest = actionRequest;
  const connectionNotice = getComposerConnectionNotice(liveUpdatesConnection?.status, hasDraft);
  const canUseInput = canSendInput && isComposerTransportAvailable(liveUpdatesConnection?.status);
  const isActionDecisionPending = Boolean(actionRequest);
  const isActionDecisionDisabled = Boolean(pendingActionDecision) || !canUseInput || isInterruptingPrompt;

  const canReplaceRunningPrompt =
    canUseInput &&
    !isActionDecisionPending &&
    isPromptInFlight;

  const shouldSubmitReplacement = canReplaceRunningPrompt && hasDraft;
  const canSubmitDraft =
    canUseInput &&
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
    canSendInput: canUseInput,
    sharedSessionHint: normalizedSharedSessionHint
  });
  const sharedSessionHintText =
    normalizedSharedSessionHint && compactViewport && viewerCount > 1
      ? `${viewerCount} DeskCue clients open. Sending may interrupt the current run`
      : normalizedSharedSessionHint;
  const submissionLifecycleRef = useRef<ReturnType<typeof syncComposerSubmissionLifecycle> | null>(null);
  const submissionLifecycle = syncComposerSubmissionLifecycle(
    submissionLifecycleRef.current,
    draftScopeKey,
    {
      canSubmitDraft,
      isActionDecisionPending,
      shouldSubmitReplacement
    }
  );

  submissionLifecycleRef.current = submissionLifecycle;

  useEffect(() => () => {
    submissionLifecycle.generation += 1;
  }, [draftScopeKey, submissionLifecycle]);

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

      if (buttonActsAsInterrupt && !isInterruptingPrompt && canUseInput) {
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
    handleSubmit(event: SubmitEvent<HTMLFormElement>) {
      event.preventDefault();
      void actions.submitDraft();
    },
    async sendActionDecision(decision: "approve" | "reject") {
      if (!canUseInput || isInterruptingPrompt) return;

      const field = mode === "chat" ? textAreaRef.current : textInputRef.current;
      const pendingSubmissionGeneration = submissionLifecycle.generation;
      const decisionDraftRevision = rememberComposerDraft(
        draftScopeKey,
        field?.value ?? readComposerDraft(draftScopeKey)
      );

      draftRestorationGenerationRef.current += 1;
      blurComposerField(field);

      if (field) field.value = "";
      setHasDraft(false);
      setPendingActionDecision(decision);

      const sent = await onSendInput(decision === "approve" ? "y" : "esc", {
        actionDecision: decision
      });

      if (sent) clearComposerDraft(draftScopeKey, decisionDraftRevision);
      if (submissionLifecycle.generation !== pendingSubmissionGeneration) return;

      if (!sent) {
        setPendingActionDecision(null);

        if (isComposerDraftRevisionCurrent(draftScopeKey, decisionDraftRevision)) setHasDraft(false);
        return;
      }
    },
    async submitDraft(options?: { blurDelayMs?: number }) {
      const field = mode === "chat" ? textAreaRef.current : textInputRef.current;
      const nextDraft = field?.value.trim() ?? "";
      const pendingSubmissionGeneration = submissionLifecycle.generation;

      if (!nextDraft || !canSubmitDraft) return;
      if (!(await actions.confirmSharedSessionTakeover())) return;
      if (submissionLifecycle.generation !== pendingSubmissionGeneration) return;

      const currentSubmissionState = submissionLifecycle.state;

      if (!currentSubmissionState.canSubmitDraft) return;

      const submissionDraftRevision = rememberComposerDraft(draftScopeKey, nextDraft);

      draftRestorationGenerationRef.current += 1;
      blurComposerField(field, options?.blurDelayMs);
      if (field) field.value = "";
      setHasDraft(false);

      const actionDecision = currentSubmissionState.isActionDecisionPending
        ? getDraftActionDecision(nextDraft)
        : undefined;
      const sent = await onSendInput(nextDraft, {
        actionDecision,
        replaceRunningPrompt: currentSubmissionState.shouldSubmitReplacement
      });

      if (sent) clearComposerDraft(draftScopeKey, submissionDraftRevision);
      if (submissionLifecycle.generation !== pendingSubmissionGeneration) return;
      if (!isComposerDraftRevisionCurrent(draftScopeKey, submissionDraftRevision)) return;

      if (!sent) {
        if (field) field.value = nextDraft;
        setHasDraft(true);
        return;
      }

      blurComposerField(field);
    },
    syncHasDraft(nextValue: string) {
      const nextHasDraft = nextValue.trim().length > 0;

      rememberComposerDraft(draftScopeKey, nextValue);
      setHasDraft((current) => (current === nextHasDraft ? current : nextHasDraft));
    }
  };

  useEffect(() => {
    const field = mode === "chat" ? textAreaRef.current : textInputRef.current;
    const cachedDraft = readComposerDraft(draftScopeKey);
    const restorationGeneration = draftRestorationGenerationRef.current + 1;

    draftRestorationGenerationRef.current = restorationGeneration;

    if (field) field.value = cachedDraft;

    setHasDraft(Boolean(cachedDraft.trim()));

    const draftRestoration = {
      sync() {
        if (draftRestorationGenerationRef.current !== restorationGeneration) return;

        const restoredField = mode === "chat" ? textAreaRef.current : textInputRef.current;
        const cachedDraft = readComposerDraft(draftScopeKey);
        const restoredDraft = restoredField?.value || cachedDraft;

        if (restoredField && !restoredField.value && restoredDraft) restoredField.value = restoredDraft;
        if (restoredDraft !== cachedDraft) rememberComposerDraft(draftScopeKey, restoredDraft);

        setHasDraft(Boolean(restoredDraft.trim()));
      }
    };

    const frame = window.requestAnimationFrame(draftRestoration.sync);
    const restoredDraftTimer = window.setTimeout(draftRestoration.sync, 250);

    return () => {
      if (draftRestorationGenerationRef.current === restorationGeneration) draftRestorationGenerationRef.current += 1;

      window.cancelAnimationFrame(frame);
      window.clearTimeout(restoredDraftTimer);
    };
  }, [draftScopeKey, mode]);

  useEffect(() => subscribeComposerDraft(draftScopeKey, (draft) => {
    const field = mode === "chat" ? textAreaRef.current : textInputRef.current;

    if (field && field.value !== draft) field.value = draft;

    setHasDraft(Boolean(draft.trim()));
  }), [draftScopeKey, mode]);

  useEffect(() => {
    if (!actionRequest) setPendingActionDecision(null);
  }, [actionRequest]);

  return {
    buttonActsAsInterrupt,
    canUseInput,
    canSubmitDraft,
    composerInputId,
    connectionNotice,
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
