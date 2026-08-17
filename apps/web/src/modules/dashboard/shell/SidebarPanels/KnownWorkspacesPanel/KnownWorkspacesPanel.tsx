import clsx from "clsx";

import { SidebarPanel } from "@modules/dashboard/shell/SidebarPanels/SidebarPanel";
import type { KnownWorkspacesPanelProps } from "@modules/dashboard/shell/SidebarPanels/types";

import styles from "./styles.module.scss";

export function KnownWorkspacesPanel({
  compact,
  isBootstrapping,
  isOpen,
  isTriggerHidden = false,
  selectedWorkspaceId,
  workspaces,
  onSelectWorkspace,
  onToggleOpen
}: KnownWorkspacesPanelProps) {
  return (
    <SidebarPanel
      compact={compact}
      title="Known workspaces"
      subtitle="Manage local workspace paths"
    >
      <div className={styles.stack}>
        {isTriggerHidden ? null : (
          <button
            className={clsx(styles.button, styles.ghostButton, styles.smallButton)}
            onClick={onToggleOpen}
            type="button"
          >
            {isOpen ? "Hide workspaces" : `Show workspaces (${workspaces.length})`}
          </button>
        )}

        {isOpen ? (
          isBootstrapping ? (
            <>
              <div className={clsx(styles.listCard, styles.skeletonBlock)} aria-hidden="true" />
              <div className={clsx(styles.listCard, styles.skeletonBlock)} aria-hidden="true" />
            </>
          ) : workspaces.length === 0 ? (
            <p className={styles.muted}>No local workspace registered yet</p>
          ) : (
            <div className={styles.workspaceList}>
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  className={clsx(
                    styles.listCard,
                    styles.workspaceRow,
                    workspace.id === selectedWorkspaceId && styles.listCardSelected
                  )}
                  onClick={() => onSelectWorkspace(workspace.id)}
                  type="button"
                >
                  <strong>{workspace.name}</strong>
                  <span>{workspace.path}</span>
                  <span>
                    {workspace.isGitRepo
                      ? `git:${workspace.branch ?? "detached"}`
                      : "not a git repo"}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : null}
      </div>
    </SidebarPanel>
  );
}
