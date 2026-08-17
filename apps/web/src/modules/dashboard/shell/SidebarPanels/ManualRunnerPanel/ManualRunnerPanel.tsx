import clsx from "clsx";

import { SidebarPanel } from "@modules/dashboard/shell/SidebarPanels/SidebarPanel";
import type { ManualRunnerPanelProps } from "@modules/dashboard/shell/SidebarPanels/types";

import styles from "./styles.module.scss";

export function ManualRunnerPanel({
  canOpenNativeDialogs,
  command,
  compact,
  isOpen,
  isTriggerHidden = false,
  loading,
  pickingWorkspace,
  selectedWorkspaceId,
  workspacePath,
  workspaces,
  onAddWorkspace,
  onChangeCommand,
  onChangeWorkspacePath,
  onPickWorkspace,
  onSelectWorkspace,
  onStartSession,
  onToggleOpen
}: ManualRunnerPanelProps) {
  const shouldShowWorkspacePlaceholder = !selectedWorkspaceId;
  const canAddWorkspace = workspacePath.trim().length > 0 && !loading && !pickingWorkspace;

  return (
    <SidebarPanel
      compact={compact}
      title="Manual controls"
      subtitle="Fallback for unsupported adapters"
    >
      <div className={styles.stack}>
        {isTriggerHidden ? null : (
          <button
            className={clsx(styles.button, styles.ghostButton)}
            onClick={onToggleOpen}
            type="button"
          >
            {isOpen ? "Hide manual controls" : "Open manual controls"}
          </button>
        )}

        {isOpen ? (
          <>
            <form className={styles.stack} onSubmit={onAddWorkspace}>
              {canOpenNativeDialogs ? (
                <button
                  className={clsx(styles.button, styles.ghostButton)}
                  disabled={pickingWorkspace || loading}
                  onClick={onPickWorkspace}
                  type="button"
                >
                  {pickingWorkspace ? "Opening folder picker..." : "Pick local folder"}
                </button>
              ) : null}
              <input
                className={styles.field}
                id="manual-workspace-path"
                name="workspacePath"
                placeholder="C:\\projects\\example-app"
                value={workspacePath}
                onChange={(event) => onChangeWorkspacePath(event.target.value)}
              />
              <button
                className={styles.button}
                disabled={!canAddWorkspace}
                type="submit"
              >
                Add workspace
              </button>
            </form>

            <form className={clsx(styles.stack, styles.formDivider)} onSubmit={onStartSession}>
              <select
                className={styles.field}
                id="manual-workspace-select"
                name="workspaceId"
                value={selectedWorkspaceId}
                onChange={(event) => onSelectWorkspace(event.target.value)}
              >
                {shouldShowWorkspacePlaceholder ? <option value="">Select workspace</option> : null}
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              <input
                className={styles.field}
                id="manual-command"
                name="command"
                placeholder="codex, claude, npm run dev, python app.py"
                value={command}
                onChange={(event) => onChangeCommand(event.target.value)}
              />
              <button
                className={clsx(styles.button, styles.ghostButton)}
                disabled={loading || !selectedWorkspaceId || !command.trim()}
                type="submit"
              >
                Run manual command
              </button>
            </form>
          </>
        ) : null}
      </div>
    </SidebarPanel>
  );
}
