import clsx from "clsx";

import { getDeskCueRuntime } from "@runtime";

import { ActionDecisionPanel } from "./ActionDecisionPanel";
import styles from "./styles.module.scss";
import type { SessionMessageComposerProps } from "./types";
import { useSessionMessageComposerController } from "./useSessionMessageComposerController";

export function SessionMessageComposer(props: SessionMessageComposerProps) {
  const sessionCommandsEnabled = getDeskCueRuntime().features.sessionCommands;
  const {
    mode,
    compactViewport = false,
    canSendInput,
    sharedSessionHint,
    isInterruptingPrompt
  } = props;

  const {
    buttonActsAsInterrupt,
    canSubmitDraft,
    composerInputId,
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
            aria-label="Remote session is read only"
            className={clsx(styles.field, styles.fieldTextarea)}
            disabled
            placeholder="Remote session is read only"
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
            className={styles.field}
            disabled={!canSendInput}
            placeholder="continue, explain, fix, or approve"
            ref={textInputRef}
            onChange={(event) => syncHasDraft(event.target.value)}
            onBlur={handleComposerFieldBlur}
            onFocus={handleComposerFieldFocus}
          />
          <button className={styles.primaryButton} disabled={!hasDraft || !canSubmitDraft} type="submit">
            {shouldSubmitReplacement ? "Take over" : "Send"}
          </button>
        </form>
        {shouldShowSharedSessionHint ? (
          <p className={clsx(styles.nextMessageSubtle, styles.sharedSessionHint)}>
            {sharedSessionHint}
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
            aria-labelledby={`${composerInputId}-label`}
            className={clsx(
              styles.field,
              styles.fieldTextarea,
              styles.transcriptComposerWithButton
            )}
            disabled={!canSendInput}
            id={composerInputId}
            name="session-message"
            placeholder={
              canSendInput
                ? compactViewport
                  ? "continue, explain, or unblock the agent"
                  : "continue with the next change, explain the diff, or unblock the agent"
                : "This session is read only"
            }
            ref={textAreaRef}
            title={sharedSessionHint ?? undefined}
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
            className={styles.sendButtonInside}
            disabled={
              isInterruptingPrompt ||
              (buttonActsAsInterrupt ? !canSendInput : (!hasDraft || !canSubmitDraft))
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
          </button>
        </div>
      )}
      {shouldShowSharedSessionHint ? (
        <p className={clsx(styles.nextMessageSubtle, styles.sharedSessionHint)}>
          {sharedSessionHintText}
        </p>
      ) : null}
    </form>
  );
}
