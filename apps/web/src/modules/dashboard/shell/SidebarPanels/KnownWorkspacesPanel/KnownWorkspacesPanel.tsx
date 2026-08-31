import clsx from "clsx";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceSummary } from "@deskcue/protocol";
import { SidebarPanel } from "@modules/dashboard/shell/SidebarPanels/SidebarPanel";
import type { KnownWorkspacesPanelProps } from "@modules/dashboard/shell/SidebarPanels/types";

import styles from "./styles.module.scss";

const WORKSPACE_SEARCH_THRESHOLD = 6;

function matchesWorkspaceQuery(workspace: WorkspaceSummary, normalizedQuery: string) {
  if (!normalizedQuery) return true;

  return [workspace.name, workspace.path, workspace.branch ?? ""]
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

function findWorkspaceReturnTarget(workspaceList: ParentNode | null) {
  const selectedWorkspace = workspaceList?.querySelector<HTMLElement>(
    "[data-known-workspace-selected]"
  );
  const firstWorkspace = workspaceList?.querySelector<HTMLElement>(
    "[data-known-workspace-row]"
  );

  return selectedWorkspace ?? firstWorkspace;
}

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
  const searchInputId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchHadFocusRef = useRef(false);
  const pendingSearchFocusHandoffRef = useRef(false);
  const searchStatusRef = useRef<HTMLParagraphElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const workspaceListRef = useRef<HTMLDivElement>(null);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const normalizedQuery = workspaceQuery.trim().toLocaleLowerCase();
  const shouldShowSearch = workspaces.length >= WORKSPACE_SEARCH_THRESHOLD;
  const isSearchSurfaceVisible = isOpen && !isBootstrapping && shouldShowSearch;
  const workspaceFocusSurfaceKey = !isOpen
    ? "closed"
    : isBootstrapping
      ? "loading"
      : workspaces.length === 0
        ? "empty"
        : shouldShowSearch ? "search" : "list";
  const effectiveQuery = shouldShowSearch ? normalizedQuery : "";

  const visibleWorkspaces = useMemo(
    () => workspaces.filter((workspace) => matchesWorkspaceQuery(workspace, effectiveQuery)),
    [effectiveQuery, workspaces]
  );

  useLayoutEffect(() => {
    const activeElement = document.activeElement;
    const searchLostFocusToRemovedSurface = searchHadFocusRef.current &&
      activeElement === document.body;

    if (searchLostFocusToRemovedSurface) {
      pendingSearchFocusHandoffRef.current = true;
      searchHadFocusRef.current = false;
    }

    if (!shouldShowSearch && workspaceQuery) setWorkspaceQuery("");
    if (!pendingSearchFocusHandoffRef.current) return;

    if (activeElement !== document.body && activeElement !== searchStatusRef.current) {
      pendingSearchFocusHandoffRef.current = false;
      return;
    }

    if (isSearchSurfaceVisible) {
      searchInputRef.current?.focus();
      pendingSearchFocusHandoffRef.current = false;
      return;
    }

    const workspaceTarget = findWorkspaceReturnTarget(workspaceListRef.current);

    if (workspaceTarget) {
      workspaceTarget.focus();
      pendingSearchFocusHandoffRef.current = false;
      return;
    }

    if (searchStatusRef.current) {
      searchStatusRef.current.focus();
      return;
    }

    searchToggleRef.current?.focus();
    pendingSearchFocusHandoffRef.current = false;
  }, [isSearchSurfaceVisible, shouldShowSearch, workspaceFocusSurfaceKey, workspaceQuery]);

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
            ref={searchToggleRef}
            type="button"
          >
            {isOpen ? "Hide workspaces" : `Show workspaces (${workspaces.length})`}
          </button>
        )}

        {isOpen ? (
          isBootstrapping ? (
            <>
              <p
                className={clsx(styles.muted, styles.focusStatus)}
                ref={searchStatusRef}
                role="status"
                tabIndex={-1}
              >
                Loading workspaces…
              </p>
              <div className={clsx(styles.listCard, styles.skeletonBlock)} aria-hidden="true" />
              <div className={clsx(styles.listCard, styles.skeletonBlock)} aria-hidden="true" />
            </>
          ) : workspaces.length === 0 ? (
            <p
              className={clsx(styles.muted, styles.focusStatus)}
              ref={searchStatusRef}
              role="status"
              tabIndex={-1}
            >
              No local workspace registered yet
            </p>
          ) : (
            <>
              {shouldShowSearch ? (
                <div
                  className={styles.searchTools}
                  onBlurCapture={(event) => {
                    if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) {
                      searchHadFocusRef.current = false;
                    }
                  }}
                  onFocusCapture={() => {
                    searchHadFocusRef.current = true;
                  }}
                >
                  <label className={styles.srOnly} htmlFor={searchInputId}>
                    Search workspaces
                  </label>
                  <div className={styles.searchRow}>
                    <input
                      className={styles.searchInput}
                      id={searchInputId}
                      placeholder="Search name, path, or branch"
                      ref={searchInputRef}
                      type="search"
                      value={workspaceQuery}
                      onChange={(event) => setWorkspaceQuery(event.target.value)}
                    />
                    {workspaceQuery ? (
                      <button
                        aria-label="Clear workspace search"
                        className={styles.clearSearch}
                        onClick={() => {
                          setWorkspaceQuery("");
                          searchInputRef.current?.focus();
                        }}
                        type="button"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <p aria-live="polite" className={styles.resultSummary}>
                    {effectiveQuery
                      ? `${visibleWorkspaces.length} of ${workspaces.length} workspaces`
                      : `${workspaces.length} workspaces`}
                  </p>
                </div>
              ) : null}

              {visibleWorkspaces.length > 0 ? (
                <div className={styles.workspaceList} ref={workspaceListRef}>
                  {visibleWorkspaces.map((workspace) => (
                    <button
                      aria-current={workspace.id === selectedWorkspaceId ? "true" : undefined}
                      key={workspace.id}
                      className={clsx(
                        styles.listCard,
                        styles.workspaceRow,
                        workspace.id === selectedWorkspaceId && styles.listCardSelected
                      )}
                      onClick={() => onSelectWorkspace(workspace.id)}
                      data-known-workspace-row=""
                      data-known-workspace-selected={workspace.id === selectedWorkspaceId ? "" : undefined}
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
              ) : (
                <div className={styles.emptySearchResult}>
                  <strong>No matching workspaces</strong>
                  <span>Try a name, path, or branch.</span>
                </div>
              )}
            </>
          )
        ) : null}
      </div>
    </SidebarPanel>
  );
}
