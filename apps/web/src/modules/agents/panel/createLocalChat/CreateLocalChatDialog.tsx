import clsx from "clsx";
import { useEffect, useId, useRef } from "react";

import ChevronDownIcon from "@assets/images/icon-chevron-down.svg?react";
import { Modal } from "@components/Modal/index";

import { CreateLocalChatFieldIcon } from "./CreateLocalChatFieldIcon";
import { LocalRuntimeIcon } from "./LocalRuntimeIcon";
import styles from "./styles.module.scss";
import type { CreateLocalChatDialogProps } from "./types";

const FOCUS_REVEAL_MARGIN_PX = 4;

function focusWithinDialogBody(element: HTMLElement | null) {
  if (!element) return;

  element.focus({ preventScroll: true });

  const scrollRegion = element.closest("form")?.parentElement;

  if (!scrollRegion) return;

  const elementBounds = element.getBoundingClientRect();
  const scrollBounds = scrollRegion.getBoundingClientRect();
  const hiddenAbove = scrollBounds.top + FOCUS_REVEAL_MARGIN_PX - elementBounds.top;
  const hiddenBelow = elementBounds.bottom - (scrollBounds.bottom - FOCUS_REVEAL_MARGIN_PX);

  if (hiddenAbove > 0) {
    scrollRegion.scrollTop -= hiddenAbove;
  } else if (hiddenBelow > 0) {
    scrollRegion.scrollTop += hiddenBelow;
  }
}

export function CreateLocalChatDialog({
  errorMessage,
  isOpen,
  isSubmitting,
  modelErrorMessage,
  models,
  modelsLoadState,
  runtimes,
  selectedModelId,
  selectedRuntimeId,
  selectedWorkspaceId,
  workspaces,
  onClose,
  onCreate,
  onModelChange,
  onRetryModels,
  onRuntimeChange,
  onWorkspaceChange
}: CreateLocalChatDialogProps) {
  const createFocusOriginRef = useRef<HTMLElement | null>(null);
  const createLocalChatFormId = useId();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const modelFeedbackRef = useRef<HTMLDivElement>(null);
  const modelRetryButtonRef = useRef<HTMLButtonElement>(null);
  const modelSelectRef = useRef<HTMLSelectElement>(null);
  const retryingModelsRef = useRef(false);
  const modelSelectDisabled =
    !selectedRuntimeId || modelsLoadState !== "ready" || isSubmitting;
  const createDisabled =
    !selectedRuntimeId || !selectedModelId || modelsLoadState !== "ready" || isSubmitting;
  const selectedRuntime = runtimes.find((runtime) => runtime.id === selectedRuntimeId);
  const modelsLoadingMessage = selectedRuntime?.status === "loading"
    ? `Starting ${selectedRuntime.label}…`
    : "Loading models…";

  useEffect(() => {
    if (!retryingModelsRef.current || modelsLoadState === "loading") return;

    const feedbackOwnsFocus = document.activeElement === modelFeedbackRef.current;

    retryingModelsRef.current = false;

    if (!feedbackOwnsFocus) return;

    if (modelsLoadState === "ready") {
      focusWithinDialogBody(modelSelectRef.current);
    } else if (modelsLoadState === "error") {
      focusWithinDialogBody(modelRetryButtonRef.current);
    }
  }, [modelsLoadState]);

  useEffect(() => {
    if (!isOpen) {
      createFocusOriginRef.current = null;

      return;
    }

    if (isSubmitting || !errorMessage || !createFocusOriginRef.current) return;

    const focusOrigin = createFocusOriginRef.current;
    const activeElement = document.activeElement;
    const focusStillOwned =
      activeElement === focusOrigin ||
      activeElement === createButtonRef.current ||
      activeElement === document.body ||
      activeElement?.getAttribute("role") === "dialog";

    createFocusOriginRef.current = null;

    if (focusStillOwned) formErrorRef.current?.focus();
  }, [errorMessage, isOpen, isSubmitting]);

  return (
    <Modal
      bodyClassName={styles.modalBody}
      className={styles.dialog}
      closeLabel="Close new local chat dialog"
      description="Choose a local runtime, model, and optional workspace."
      footer={(
        <div className={styles.actions}>
          <button
            className={styles.createButton}
            disabled={createDisabled}
            form={createLocalChatFormId}
            ref={createButtonRef}
            type="submit"
          >
            {isSubmitting ? "Creating…" : "Create chat"}
          </button>
          {isSubmitting ? (
            <span className={styles.srOnly} role="status">Creating chat…</span>
          ) : null}
        </div>
      )}
      isOpen={isOpen}
      title="New local chat"
      onClose={onClose}
    >
      <form
        aria-busy={modelsLoadState === "loading" || isSubmitting}
        className={styles.form}
        id={createLocalChatFormId}
        onSubmit={(event) => {
          event.preventDefault();
          createFocusOriginRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

          onCreate();
        }}
      >
        <fieldset className={styles.runtimeFieldset} disabled={isSubmitting}>
          <legend className={styles.fieldTitle}>Runtime</legend>
          <div className={styles.runtimeList}>
            {runtimes.map((runtime) => {
              const selected = runtime.id === selectedRuntimeId;

              return (
                <label
                  className={clsx(styles.runtimeCard, selected && styles.runtimeCardSelected)}
                  data-status={runtime.status}
                  key={runtime.id}
                >
                  <input
                    checked={selected}
                    disabled={runtime.disabled}
                    name="local-chat-runtime"
                    type="radio"
                    value={runtime.id}
                    aria-label={`${runtime.label}. ${runtime.statusText}. ${runtime.description}`}
                    onChange={() => onRuntimeChange(runtime.id)}
                  />
                  <span className={styles.runtimeIcon} data-runtime={runtime.id}>
                    <LocalRuntimeIcon runtimeId={runtime.id} />
                  </span>
                  <span className={styles.runtimeCardCopy}>
                    <strong>{runtime.label}</strong>
                    <span className={styles.runtimeStatus}>
                      {runtime.statusText}
                    </span>
                  </span>
                  <span className={styles.runtimeSelection} aria-hidden="true">
                    {selected ? "✓" : ""}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className={styles.fieldLabel}>
          <label className={styles.fieldTitle} htmlFor="local-chat-model">Model</label>
          <span className={styles.selectControl}>
            <span className={styles.fieldIcon}><CreateLocalChatFieldIcon kind="model" /></span>
            <select
              aria-busy={modelsLoadState === "loading"}
              disabled={modelSelectDisabled}
              id="local-chat-model"
              name="local-chat-model"
              ref={modelSelectRef}
              value={selectedModelId}
              onChange={(event) => onModelChange(event.target.value)}
            >
              <option value="">
                {modelsLoadState === "loading"
                  ? modelsLoadingMessage
                  : selectedRuntimeId
                    ? "Choose a model"
                    : "Choose a runtime first"}
              </option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
            <ChevronDownIcon
              aria-hidden="true"
              className={styles.selectArrow}
              focusable="false"
            />
          </span>
          {modelsLoadState === "ready" && selectedRuntimeId && models.length === 0 ? (
            <small className={styles.fieldHelp}>No installed chat models were found for this runtime.</small>
          ) : null}
          <div
            className={styles.modelFeedback}
            ref={modelFeedbackRef}
            tabIndex={-1}
          >
            {modelsLoadState === "loading" ? (
              <span className={styles.modelLoading} role="status">{modelsLoadingMessage}</span>
            ) : null}
            {modelsLoadState === "error" ? (
              <span className={styles.modelError} role="alert">
                <span>{modelErrorMessage ?? "DeskCue could not load installed models."}</span>
                <button
                  ref={modelRetryButtonRef}
                  type="button"
                  onClick={() => {
                    retryingModelsRef.current = true;
                    onRetryModels();
                    queueMicrotask(() => focusWithinDialogBody(modelFeedbackRef.current));
                  }}
                >
                  Retry
                </button>
              </span>
            ) : null}
          </div>
        </div>

        <label className={styles.fieldLabel}>
          <span className={styles.fieldTitle}>Workspace (optional)</span>
          <span className={styles.selectControl}>
            <span className={styles.fieldIcon}><CreateLocalChatFieldIcon kind="workspace" /></span>
            <select
              disabled={isSubmitting}
              name="local-chat-workspace"
              value={selectedWorkspaceId}
              onChange={(event) => onWorkspaceChange(event.target.value)}
            >
              <option value="">None</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.path ? `${workspace.label} — ${workspace.path}` : workspace.label}
                </option>
              ))}
            </select>
            <ChevronDownIcon
              aria-hidden="true"
              className={styles.selectArrow}
              focusable="false"
            />
          </span>
        </label>

        {errorMessage ? (
          <div
            className={styles.formError}
            ref={formErrorRef}
            role="alert"
            tabIndex={-1}
          >
            {errorMessage}
          </div>
        ) : null}

      </form>
    </Modal>
  );
}
