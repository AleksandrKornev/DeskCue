import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { toast } from "sonner";

import FolderIcon from "@assets/images/icon-folder.svg?react";
import { Modal } from "@components/Modal";

import styles from "./styles.module.scss";
import type { AddWorkspaceActionProps } from "./types";

type WorkspaceActionError = {
  source: "path" | "picker";
  message: string;
};

type PendingWorkspaceAction = {
  generation: number;
  label: string;
  source: "path" | "picker";
};

type PathFocusOperation = {
  focusMoved: boolean;
  origin: HTMLElement | null;
};

function canRestorePathFocus(operation: PathFocusOperation | null) {
  if (!operation || operation.focusMoved) return false;

  const activeElement = document.activeElement;

  return activeElement === document.body || activeElement === operation.origin;
}

export function AddWorkspaceAction({
  canOpenNativeDialogs,
  loading,
  pickingWorkspace,
  workspacePath,
  onAddWorkspace,
  onChangeWorkspacePath,
  onPickWorkspace
}: AddWorkspaceActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState<WorkspaceActionError | null>(null);
  const [manualPathOpen, setManualPathOpen] = useState(!canOpenNativeDialogs);
  const [pendingAction, setPendingAction] = useState<PendingWorkspaceAction | null>(null);
  const dialogGenerationRef = useRef(0);
  const pickerBusyObservedRef = useRef(false);
  const pickerFocusPendingRef = useRef(false);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);
  const pathFocusOperationRef = useRef<PathFocusOperation | null>(null);
  const workspacePathInputRef = useRef<HTMLInputElement>(null);
  const workspaceBusy = loading || pickingWorkspace || pendingAction !== null;
  const canAddPath = workspacePath.trim().length > 0 && !workspaceBusy;
  const actionErrorOutsideSelectedFlow = Boolean(
    actionError && (actionError.source === "picker" ? manualPathOpen : !manualPathOpen)
  );

  useEffect(() => {
    if (!canOpenNativeDialogs) setManualPathOpen(true);
  }, [canOpenNativeDialogs]);

  useEffect(() => {
    if (!pickerFocusPendingRef.current) return;

    if (!canOpenNativeDialogs || manualPathOpen) {
      pickerBusyObservedRef.current = false;
      pickerFocusPendingRef.current = false;
      return;
    }

    if (pickingWorkspace) {
      pickerBusyObservedRef.current = true;
      return;
    }

    if (!pickerBusyObservedRef.current || !isOpen) return;

    const pickerButton = pickerButtonRef.current;

    if (!pickerButton || pickerButton.disabled) return;

    const dialog = pickerButton.closest('[role="dialog"]');
    const activeElement = document.activeElement;
    const focusIsUnowned = activeElement === document.body || activeElement === dialog;

    pickerBusyObservedRef.current = false;
    pickerFocusPendingRef.current = false;
    if (focusIsUnowned) pickerButton.focus();
  }, [canOpenNativeDialogs, isOpen, loading, manualPathOpen, pickingWorkspace, workspaceBusy]);

  const open = useCallback(() => {
    dialogGenerationRef.current += 1;
    pickerBusyObservedRef.current = false;
    pickerFocusPendingRef.current = false;
    pathFocusOperationRef.current = null;
    setActionError(null);
    setManualPathOpen(!canOpenNativeDialogs || pendingAction?.source === "path");
    setIsOpen(true);
  }, [canOpenNativeDialogs, pendingAction?.source]);

  const close = useCallback(() => {
    dialogGenerationRef.current += 1;
    pickerBusyObservedRef.current = false;
    pickerFocusPendingRef.current = false;
    pathFocusOperationRef.current = null;
    setIsOpen(false);
    setActionError(null);
  }, []);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={styles.trigger}
        onClick={open}
        type="button"
      >
        <FolderIcon aria-hidden="true" className={styles.triggerIcon} focusable="false" />
        <span>Add workspace</span>
      </button>

      <Modal
        bodyClassName={styles.modalBody}
        closeLabel="Close add workspace dialog"
        closeOnHistoryBack
        description="Choose a folder in the DeskCue host browser, or enter its absolute path."
        isOpen={isOpen}
        title="Add workspace"
        onClose={close}
      >
        <div
          aria-busy={workspaceBusy || undefined}
          className={styles.content}
          onFocusCapture={() => {
            const operation = pathFocusOperationRef.current;

            if (operation && document.activeElement !== operation.origin) operation.focusMoved = true;
          }}
        >
          <section
            aria-labelledby="workspace-picker-title"
            className={styles.pickerSection}
            hidden={manualPathOpen}
          >
            <div className={styles.sectionCopy}>
              <h3 id="workspace-picker-title">Choose on this machine</h3>
              <p>
                {canOpenNativeDialogs
                  ? "Host browser only · registers immediately"
                  : "Folder picker is available only in the trusted DeskCue host browser."}
              </p>
            </div>
            {canOpenNativeDialogs ? (
              <button
                aria-describedby={actionError?.source === "picker"
                  ? "add-workspace-picker-error"
                  : undefined}
                className={styles.primaryAction}
                disabled={workspaceBusy}
                ref={pickerButtonRef}
                onClick={() => {
                  const requestGeneration = dialogGenerationRef.current;

                  pickerBusyObservedRef.current = false;
                  pickerFocusPendingRef.current = true;
                  pathFocusOperationRef.current = null;
                  setActionError(null);
                  setPendingAction({
                    generation: requestGeneration,
                    label: "Opening the local folder picker…",
                    source: "picker"
                  });
                  void onPickWorkspace().then((result) => {
                    setPendingAction(null);

                    if (result.status === "created") {
                      toast.success(dialogGenerationRef.current === requestGeneration
                        ? "Workspace added."
                        : "Previous add attempt finished. Workspace added.");
                      if (dialogGenerationRef.current === requestGeneration) close();

                      return;
                    }

                    if (result.status === "failed") {
                      if (dialogGenerationRef.current !== requestGeneration) {
                        toast.error(`Previous add attempt failed: ${result.error}`, { duration: 5000 });
                        return;
                      }

                      setActionError({ source: "picker", message: result.error });
                    }
                  });
                }}
                type="button"
              >
                <FolderIcon aria-hidden="true" focusable="false" />
                <span>{pickingWorkspace ? "Opening folder picker…" : "Choose and add local folder"}</span>
              </button>
            ) : (
              <p className={styles.remoteHint}>
                Enter a folder path that exists on the DeskCue host machine instead.
              </p>
            )}
            {actionError?.source === "picker" && !manualPathOpen ? (
              <p className={styles.pickerError} id="add-workspace-picker-error" role="alert">
                {actionError.message}
              </p>
            ) : null}
          </section>

          <details
            className={styles.manualDisclosure}
            open={manualPathOpen}
            onClick={(event) => {
              if (workspaceBusy && event.target instanceof HTMLElement && event.target.closest("summary")) {
                event.preventDefault();
              }
            }}
            onToggle={(event) => setManualPathOpen(event.currentTarget.open)}
          >
            <summary aria-disabled={workspaceBusy || undefined}>
              {canOpenNativeDialogs ? "Add a path manually" : "Enter a path on the DeskCue host"}
            </summary>
            <form
              className={styles.manualForm}
              onSubmit={(event) => {
                const requestGeneration = dialogGenerationRef.current;
                const submittedPath = workspacePath;
                const activeElement = document.activeElement;

                pickerBusyObservedRef.current = false;
                pickerFocusPendingRef.current = false;
                pathFocusOperationRef.current = {
                  focusMoved: false,
                  origin: activeElement instanceof HTMLElement ? activeElement : workspacePathInputRef.current
                };

                setActionError(null);
                setPendingAction({
                  generation: requestGeneration,
                  label: `Adding ${submittedPath}…`,
                  source: "path"
                });
                void onAddWorkspace(event).then((result) => {
                  setPendingAction(null);

                  if (result.status === "created") {
                    toast.success(dialogGenerationRef.current === requestGeneration
                      ? "Workspace added."
                      : "Previous add attempt finished. Workspace added.");
                    if (dialogGenerationRef.current === requestGeneration) close();

                    return;
                  }

                  if (result.status === "failed") {
                    if (dialogGenerationRef.current !== requestGeneration) {
                      toast.error(`Previous add attempt failed: ${result.error}`, { duration: 5000 });
                      return;
                    }

                    const focusOperation = pathFocusOperationRef.current;

                    pathFocusOperationRef.current = null;
                    setActionError({ source: "path", message: result.error });
                    if (canRestorePathFocus(focusOperation)) workspacePathInputRef.current?.focus();
                  }
                });
              }}
            >
              <label htmlFor="dashboard-workspace-path">Workspace folder</label>
              <input
                aria-describedby={actionError?.source === "path"
                  ? "dashboard-workspace-path-help dashboard-workspace-path-error"
                  : "dashboard-workspace-path-help"}
                aria-invalid={actionError?.source === "path" || undefined}
                autoComplete="off"
                id="dashboard-workspace-path"
                name="workspacePath"
                placeholder="Absolute path on the DeskCue host"
                ref={workspacePathInputRef}
                type="text"
                value={workspacePath}
                onChange={(event) => {
                  if (actionError?.source === "path") setActionError(null);
                  onChangeWorkspacePath(event.target.value);
                }}
              />
              <p className={styles.fieldHelp} id="dashboard-workspace-path-help">
                The folder remains on the DeskCue host.
              </p>
              {actionError?.source === "path" && manualPathOpen ? (
                <p className={styles.fieldError} id="dashboard-workspace-path-error" role="alert">
                  {actionError.message}
                </p>
              ) : null}
              <button className={styles.addPathAction} disabled={!canAddPath} type="submit">
                {loading ? "Adding path…" : "Add path"}
              </button>
            </form>
          </details>

          {actionError && actionErrorOutsideSelectedFlow ? (
            <p
              className={actionError.source === "path" ? styles.fieldError : styles.pickerError}
              id={actionError.source === "path"
                ? "dashboard-workspace-path-error"
                : "add-workspace-picker-error"}
              role="alert"
            >
              {actionError.message}
            </p>
          ) : null}

          {pendingAction ? (
            <p className={styles.pendingStatus} role="status">
              {pendingAction.generation === dialogGenerationRef.current
                ? pendingAction.label
                : `Previous add attempt is still running: ${pendingAction.label}`}
            </p>
          ) : null}

          <div className={styles.footer}>
            <button onClick={close} type="button">
              {workspaceBusy ? "Close" : "Cancel"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
