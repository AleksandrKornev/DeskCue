import clsx from "clsx";

import {
  getDeskCueRuntime,
  resolveSessionCommandsUnavailableReason
} from "@runtime";

import { ActionDecisionPanel } from "./ActionDecisionPanel";
import { normalizeComposerNotice } from "./helpers";
import styles from "./styles.module.scss";
import type { SessionMessageComposerProps } from "./types";
import { useSessionMessageComposerController } from "./useSessionMessageComposerController";

export function SessionMessageComposer(props: SessionMessageComposerProps) {
  const runtime = getDeskCueRuntime();
  const sessionCommandsEnabled = runtime.features.sessionCommands;
  const sessionCommandsUnavailableReason = resolveSessionCommandsUnavailableReason(runtime);
  const {
    mode,
    compactViewport = false,
    canSendInput,
    inputUnavailableLabel,
    isInterruptingPrompt
  } = props;
  const disabledInputLabel = normalizeComposerNotice(inputUnavailableLabel) ?? "This chat is view only";

  const {
    buttonActsAsInterrupt,
    canUseInput,
    canSubmitDraft,
    composerInputId,
    connectionNotice,
    handleChatSendButtonClick,
    handleComposerFieldBlur,
    handleComposerFieldFocus,
    handleKeyDown,
    handleSendPointerDown,
    handleSubmit,
    hasDraft,
    interruptButtonLabel,
    isActionDecisionDisabled,
    isComposerFieldFocused,
    sendActionDecision,
    sendButtonLabel,
    sharedSessionHintText,
    shouldShowSharedSessionHint,
    shouldSubmitReplacement,
    syncHasDraft,
    textAreaRef,
    textInputRef,
    visibleActionRequest
  } = useSessionMessageComposerController(props);
  const composerNotice = canSendInput ? connectionNotice : disabledInputLabel;
  const unavailableInputLabel = canSendInput ? "Waiting for connection" : "Input unavailable";

  if (!sessionCommandsEnabled) {
    if (mode === "inline") {
      return (
        <p className={styles.nextMessageSubtle}>
          {sessionCommandsUnavailableReason}
        </p>
      );
    }

    return (
      <div className={clsx(styles.chatComposer, compactViewport && styles.chatComposerMinimal)}>
        <div className={styles.chatComposerInputWrap}>
          <textarea
            aria-describedby={`${composerInputId}-control-unavailable`}
            aria-label="Review-only chat"
            className={clsx(styles.field, styles.fieldTextarea)}
            disabled
            id={composerInputId}
            name="session-message"
            placeholder="Review only"
            title={sessionCommandsUnavailableReason}
          />
        </div>
        <p
          className={styles.nextMessageSubtle}
          id={`${composerInputId}-control-unavailable`}
        >
          {sessionCommandsUnavailableReason}
        </p>
      </div>
    );
  }

  if (mode === "inline") {
    return (
      <>
        {visibleActionRequest ? (
          <ActionDecisionPanel
            actionRequest={visibleActionRequest}
            disabled={isActionDecisionDisabled}
            onApprove={() => sendActionDecision("approve")}
            onReject={() => sendActionDecision("reject")}
          />
        ) : null}
        <form className={styles.inlineForm} onSubmit={handleSubmit}>
          <input
            aria-describedby={composerNotice ? `${composerInputId}-unavailable` : undefined}
            aria-label="Next message"
            className={styles.field}
            disabled={!canUseInput}
            id={composerInputId}
            name="session-message"
            placeholder={canUseInput ? "continue, explain, fix, or approve" : unavailableInputLabel}
            ref={textInputRef}
            title={shouldShowSharedSessionHint ? sharedSessionHintText ?? undefined : undefined}

            onChange={(event) => syncHasDraft(event.target.value)}
            onBlur={handleComposerFieldBlur}
            onFocus={handleComposerFieldFocus}
          />
          <button className={styles.primaryButton} disabled={!hasDraft || !canSubmitDraft} type="submit">
            {shouldSubmitReplacement ? "Take over" : "Send"}
          </button>
        </form>
        {composerNotice ? (
          <p aria-live="polite" className={styles.nextMessageSubtle} id={`${composerInputId}-unavailable`}>
            {composerNotice}
          </p>
        ) : null}
        {shouldShowSharedSessionHint ? (
          <p className={clsx(styles.nextMessageSubtle, styles.sharedSessionHint)}>
            {sharedSessionHintText}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <form
      className={clsx(
        styles.chatComposer,
        compactViewport && styles.chatComposerMinimal,
        compactViewport && styles.chatComposerCompactViewport,
        isComposerFieldFocused && styles.chatComposerFieldFocused,
        shouldShowSharedSessionHint && styles.chatComposerWithSharedHint
      )}
      onSubmit={handleSubmit}
    >
      <span className={styles.srOnly} id={`${composerInputId}-label`}>
        Next message
      </span>
      {visibleActionRequest ? (
        <ActionDecisionPanel
          actionRequest={visibleActionRequest}
          disabled={isActionDecisionDisabled}
          onApprove={() => sendActionDecision("approve")}
          onReject={() => sendActionDecision("reject")}
        />
      ) : (
        <div className={styles.chatComposerInputWrap}>
          <textarea
            aria-describedby={composerNotice ? `${composerInputId}-unavailable` : undefined}
            aria-labelledby={`${composerInputId}-label`}
            className={clsx(
              styles.field,
              styles.fieldTextarea,
              styles.transcriptComposerWithButton,
              buttonActsAsInterrupt && styles.transcriptComposerWithInterruptButton
            )}
            disabled={!canUseInput}
            id={composerInputId}
            name="session-message"
            placeholder={
              canUseInput
                ? compactViewport
                  ? "continue, explain, or unblock the agent"
                  : "continue with the next change, explain the diff, or unblock the agent"
                : unavailableInputLabel
            }

            ref={textAreaRef}
            title={shouldShowSharedSessionHint ? sharedSessionHintText ?? undefined : undefined}

            onChange={(event) => syncHasDraft(event.target.value)}
            onBlur={handleComposerFieldBlur}
            onFocus={handleComposerFieldFocus}
            onKeyDown={handleKeyDown}
          />
          <button
            aria-label={
              isInterruptingPrompt
                ? "Interrupting prompt"
                : buttonActsAsInterrupt
                  ? interruptButtonLabel
                  : sendButtonLabel
            }

            className={clsx(
              styles.sendButtonInside,
              buttonActsAsInterrupt && styles.interruptButtonInside
            )}
            disabled={
              isInterruptingPrompt ||
              (buttonActsAsInterrupt ? !canUseInput : (!hasDraft || !canSubmitDraft))
            }

            onClick={handleChatSendButtonClick}
            onPointerDown={handleSendPointerDown}
            title={
              isInterruptingPrompt
                ? "Interrupting prompt"
                : buttonActsAsInterrupt
                  ? interruptButtonLabel
                  : sendButtonLabel
            }

            type="button"
          >
            <span aria-hidden="true">
              {isInterruptingPrompt ? "…" : buttonActsAsInterrupt ? "■" : "↑"}
            </span>
            {buttonActsAsInterrupt && !isInterruptingPrompt ? (
              <span className={styles.interruptButtonLabel}>Stop</span>
            ) : null}
          </button>
        </div>
      )}
      {composerNotice ? (
        <p aria-live="polite" className={styles.nextMessageSubtle} id={`${composerInputId}-unavailable`}>
          {composerNotice}
        </p>
      ) : null}
      {shouldShowSharedSessionHint ? (
        <p className={clsx(styles.nextMessageSubtle, styles.sharedSessionHint)}>
          {sharedSessionHintText}
        </p>
      ) : null}
    </form>
  );
}
