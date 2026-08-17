import { Modal } from "@components/Modal/index";
import styles from "@modules/localLlmChats/shared/styles.module.scss";

import { LOCAL_AGENT_MODE_OPTIONS } from "./constants";
import type { LocalLlmManagedSessionDialogsProps } from "./types";

export function LocalLlmManagedSessionDialogs({
  detail,
  lmStudioModelDialogOpen,
  lmStudioModels,
  modeDialogOpen,
  onAgentModeUpdate,
  onCloseLmStudioModelDialog,
  onCloseModeDialog,
  onCloseWorkspaceDialog,
  onLmStudioModelUpdate,
  onSelectedLmStudioModelKeyChange,
  onWorkspaceIdChange,
  onWorkspaceUpdate,
  selectedLmStudioModelKey,
  updatingLmStudioModel,
  updatingWorkspace,
  workspaceDialogOpen,
  workspaceId,
  workspaces
}: LocalLlmManagedSessionDialogsProps) {
  return (
    <>
      <Modal
        description="Changes and read-only local tools use only the workspace attached to this chat"
        isOpen={workspaceDialogOpen}
        size="default"
        title="Attach workspace"
        onClose={onCloseWorkspaceDialog}
      >
        <div className={styles.workspaceDialog}>
          <label>
            <span>Workspace</span>
            <select
              disabled={updatingWorkspace}
              onChange={(event) => onWorkspaceIdChange(event.target.value)}
              value={workspaceId}
            >
              <option value="">No workspace</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
          </label>
          <p>Existing chats remain unchanged until you save this choice</p>
          <button
            className={styles.primaryButton}
            disabled={updatingWorkspace}
            onClick={onWorkspaceUpdate}
            type="button"
          >
            {updatingWorkspace ? "Saving..." : workspaceId ? "Attach workspace" : "Detach workspace"}
          </button>
        </div>
      </Modal>
      <Modal
        description="Controls what this local model may do inside the workspace attached to this chat — Full access is for a trusted machine and trusted local model, not a sandbox"
        isOpen={modeDialogOpen}
        size="default"
        title="Agent mode"
        onClose={onCloseModeDialog}
      >
        <div className={styles.modeDialog}>
          {LOCAL_AGENT_MODE_OPTIONS.map((option) => {
            const selected = detail.agentMode === option.id;
            return (
              <button
                aria-pressed={selected}
                className={selected ? `${styles.modeOption} ${styles.modeOptionSelected}` : styles.modeOption}
                disabled={selected}
                key={option.id}
                onClick={() => onAgentModeUpdate(option.id)}
                type="button"
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            );
          })}
        </div>
      </Modal>
      <Modal
        description="Choose a different installed model for future messages in this chat. The current model stays active until you save a replacement."
        isOpen={lmStudioModelDialogOpen}
        size="default"
        title="Change LM Studio model"
        onClose={onCloseLmStudioModelDialog}
      >
        <div className={styles.workspaceDialog}>
          <label>
            <span>Local model</span>
            <select
              disabled={updatingLmStudioModel || lmStudioModels === null}
              onChange={(event) => onSelectedLmStudioModelKeyChange(event.target.value)}
              value={selectedLmStudioModelKey}
            >
              <option value="">Choose a model</option>
              {(lmStudioModels ?? []).map((model) => (
                <option key={model.modelKey} value={model.modelKey}>{model.displayName}</option>
              ))}
            </select>
          </label>
          {lmStudioModels !== null && lmStudioModels.length === 0 ? (
            <p>No installed LM Studio models were found.</p>
          ) : null}
          <button
            className={styles.primaryButton}
            disabled={updatingLmStudioModel || lmStudioModels === null || !selectedLmStudioModelKey}
            onClick={onLmStudioModelUpdate}
            type="button"
          >
            {updatingLmStudioModel ? "Saving..." : "Save model"}
          </button>
        </div>
      </Modal>
    </>
  );
}
