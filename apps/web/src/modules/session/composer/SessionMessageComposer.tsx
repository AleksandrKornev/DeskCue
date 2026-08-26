import clsx from "clsx";

import { getDeskCueRuntime } from "@runtime";

import { ActionDecisionPanel } from "./ActionDecisionPanel";
import { normalizeComposerNotice } from "./helpers";
import styles from "./styles.module.scss";
import type { SessionMessageComposerProps } from "./types";
import { useSessionMessageComposerController } from "./useSessionMessageComposerController";

export function SessionMessageComposer(props: SessionMessageComposerProps) {
  const sessionCommandsEnabled = getDeskCueRuntime().features.sessionCommands;
  const {
    mode,
    compactViewport = false,
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

  if (!sessionCommandsEnabled) {
    if (mode === "inline") {
      return (
        <p className={styles.nextMessageSubtle}>
          Remote control is not enabled for this Cloud connection.
        </p>
      );
    }

    return (
      <div className={clsx(styles.chatComposer, compactViewport && styles.chatComposerMinimal)}>
        <div className={styles.chatComposerInputWrap}>
          <textarea
            aria-label="Remote control disabled"
            className={clsx(styles.field, styles.fieldTextarea)}
            disabled
            placeholder="Remote control disabled"
          />
        </div>
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
            aria-describedby={connectionNotice ? `${composerInputId}-connection` : undefined}
            className={styles.field}
            disabled={!canUseInput}
            placeholder={canUseInput ? "continue, explain, fix, or approve" : connectionNotice ?? disabledInputLabel}
            ref={textInputRef}
            title={
              shouldShowSharedSessionHint
                ? sharedSessionHintText ?? undefined
                : canUseInput
                  ? undefined
                  : connectionNotice ?? disabledInputLabel
            }

            onChange={(event) => syncHasDraft(event.target.value)}
            onBlur={handleComposerFieldBlur}
            onFocus={handleComposerFieldFocus}
          />
          <button className={styles.primaryButton} disabled={!hasDraft || !canSubmitDraft} type="submit">
            {shouldSubmitReplacement ? "Take over" : "Send"}
          </button>
        </form>
        {connectionNotice ? (
          <p aria-live="polite" className={styles.nextMessageSubtle} id={`${composerInputId}-connection`}>
            {connectionNotice}
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
            aria-describedby={connectionNotice ? `${composerInputId}-connection` : undefined}
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
                : disabledInputLabel
            }

            ref={textAreaRef}
            title={
              shouldShowSharedSessionHint
                ? sharedSessionHintText ?? undefined
                : canUseInput
                  ? undefined
                  : connectionNotice ?? disabledInputLabel
            }

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
      {connectionNotice ? (
        <p aria-live="polite" className={styles.nextMessageSubtle} id={`${composerInputId}-connection`}>
          {connectionNotice}
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
