import clsx from "clsx";

import ChevronDownIcon from "@assets/images/icon-chevron-down.svg?react";
import { Modal } from "@components/Modal/index";

import { CreateLocalChatFieldIcon } from "./CreateLocalChatFieldIcon";
import { LocalRuntimeIcon } from "./LocalRuntimeIcon";
import styles from "./styles.module.scss";
import type { CreateLocalChatDialogProps } from "./types";

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
  const modelSelectDisabled =
    !selectedRuntimeId || modelsLoadState !== "ready" || isSubmitting;
  const createDisabled =
    !selectedRuntimeId || !selectedModelId || modelsLoadState !== "ready" || isSubmitting;
  const selectedRuntime = runtimes.find((runtime) => runtime.id === selectedRuntimeId);

  return (
    <Modal
      bodyClassName={styles.modalBody}
      className={styles.dialog}
      closeLabel="Close new local chat dialog"
      description="Choose where to run it."
      isOpen={isOpen}
      title="New local chat"
      onClose={onClose}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <fieldset className={styles.runtimeFieldset} disabled={isSubmitting}>
          <legend className={styles.srOnly}>Runtime</legend>
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
              disabled={modelSelectDisabled}
              id="local-chat-model"
              name="local-chat-model"
              value={selectedModelId}
              onChange={(event) => onModelChange(event.target.value)}
            >
              <option value="">
                {modelsLoadState === "loading"
                  ? selectedRuntime?.status === "loading"
                    ? `Starting ${selectedRuntime.label}…`
                    : "Loading models…"
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
          {modelsLoadState === "error" ? (
            <span className={styles.modelError} role="alert">
              <span>{modelErrorMessage ?? "DeskCue could not load installed models."}</span>
              <button type="button" onClick={onRetryModels}>Retry</button>
            </span>
          ) : null}
        </div>

        <label className={styles.fieldLabel}>
          <span className={styles.srOnly}>Workspace (optional)</span>
          <span className={styles.selectControl}>
            <span className={styles.fieldIcon}><CreateLocalChatFieldIcon kind="workspace" /></span>
            <select
              disabled={isSubmitting}
              name="local-chat-workspace"
              value={selectedWorkspaceId}
              onChange={(event) => onWorkspaceChange(event.target.value)}
            >
              <option value="">Workspace · None</option>
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
          <div className={styles.formError} role="alert">{errorMessage}</div>
        ) : null}

        <div className={styles.actions}>
          <button className={styles.createButton} disabled={createDisabled} type="submit">
            {isSubmitting ? "Creating…" : "Create chat"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
