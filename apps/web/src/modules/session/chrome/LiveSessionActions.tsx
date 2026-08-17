import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import MoreIcon from "@assets/images/icon-more-horizontal.svg?react";
import { ConfirmDialog } from "@components/ModalDialog";
import { getDeskCueRuntime } from "@runtime";

import styles from "./styles.module.scss";
import type { LiveSessionActionsProps } from "./types";

export function LiveSessionActions({
  adapterLabel,
  canStopExternalClaudeBackground = false,
  compact = false,
  extraMenuItem,
  sessionStatus,
  showTools,
  onExitSession,
  onStopExternalClaudeBackground,
  onStopSession,
  onStopAndExitSession,
  onToggleModelContext,
  onOpenDiagnostics,
  onToggleTools,
}: LiveSessionActionsProps) {
  const features = getDeskCueRuntime().features;
  const externalHostProcessControlsEnabled = features.externalHostProcessControls;
  const [showUtilityMenu, setShowUtilityMenu] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showStopConfirmDialog, setShowStopConfirmDialog] = useState(false);

  const utilityMenuRef = useRef<HTMLDivElement | null>(null);
  const isMountedRef = useRef(true);

  const shouldPutStopInMenu =
    externalHostProcessControlsEnabled && compact && sessionStatus === "running";
  const hasUtilityActions = Boolean(
    compact ||
      shouldPutStopInMenu ||
      (externalHostProcessControlsEnabled && canStopExternalClaudeBackground) ||
      onToggleModelContext ||
      onOpenDiagnostics ||
      onToggleTools ||
      extraMenuItem
  );
  const handleStopSession = () => {
    if (isStopping) {
      return;
    }

    setIsStopping(true);
    Promise.resolve(onStopSession()).then((stopped) => {
      if (isMountedRef.current && stopped) {
        setShowStopConfirmDialog(false);
      }
    }).finally(() => {
      if (isMountedRef.current) {
        setIsStopping(false);
      }
    });
  };
  const handleStopAndExitSession = () => {
    if (isStopping) {
      return;
    }

    if (!onStopAndExitSession) {
      handleStopSession();
      return;
    }

    setIsStopping(true);
    Promise.resolve(onStopAndExitSession()).finally(() => {
      if (isMountedRef.current) {
        setIsStopping(false);
      }
    });
  };

  const renderUtilityMenu = () =>
    hasUtilityActions ? (
      <div className={styles.actionMenu} ref={utilityMenuRef}>
        <button
          aria-expanded={showUtilityMenu}
          aria-label="More actions"
          className={clsx(
            styles.ghostButton,
            styles.iconUtilityButton,
            (showUtilityMenu || showTools) && styles.activeButton
          )}
          onClick={() => setShowUtilityMenu((current) => !current)}
          title="More actions"
          type="button"
        >
          <MoreIcon className={styles.iconUtilitySvg} aria-hidden="true" focusable="false" />
        </button>

        {showUtilityMenu ? (
          <div className={styles.actionMenuPopover} role="menu">
            {compact ? (
              <button
                className={styles.actionMenuItem}
                onClick={() => {
                  setShowUtilityMenu(false);
                  onExitSession();
                }}
                role="menuitem"
                type="button"
              >
                Back to chats
              </button>
            ) : null}
            {shouldPutStopInMenu ? (
              <button
                className={clsx(styles.actionMenuItem, styles.actionMenuItemDanger)}
                disabled={isStopping}
                onClick={() => {
                  setShowUtilityMenu(false);
                  setShowStopConfirmDialog(true);
                }}
                role="menuitem"
                type="button"
              >
                {isStopping ? "Stopping..." : "Stop session"}
              </button>
            ) : null}
            {externalHostProcessControlsEnabled && canStopExternalClaudeBackground && onStopExternalClaudeBackground ? (
              <button
                className={clsx(styles.actionMenuItem, styles.actionMenuItemDanger)}
                onClick={() => {
                  setShowUtilityMenu(false);
                  onStopExternalClaudeBackground();
                }}
                role="menuitem"
                type="button"
              >
                Stop Claude background job
              </button>
            ) : null}
            {onToggleModelContext ? (
              <button
                className={styles.actionMenuItem}
                onClick={() => {
                  setShowUtilityMenu(false);
                  onToggleModelContext();
                }}
                role="menuitem"
                type="button"
              >
                Model & runtime
              </button>
            ) : null}
            {onOpenDiagnostics ? (
              <button
                className={styles.actionMenuItem}
                onClick={() => {
                  setShowUtilityMenu(false);
                  onOpenDiagnostics();
                }}
                role="menuitem"
                type="button"
              >
                Diagnostics
              </button>
            ) : null}
            {onToggleTools ? (
              <button
                className={styles.actionMenuItem}
                onClick={() => {
                  setShowUtilityMenu(false);
                  onToggleTools();
                }}
                role="menuitem"
                type="button"
              >
                {showTools ? "Hide tools" : "Tools"}
              </button>
            ) : null}
            {extraMenuItem}
          </div>
        ) : null}
      </div>
    ) : null;

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!showUtilityMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!utilityMenuRef.current?.contains(event.target as Node)) {
        setShowUtilityMenu(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowUtilityMenu(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showUtilityMenu]);

  useEffect(() => {
    if (!showStopConfirmDialog) {
      return;
    }

    setShowUtilityMenu(false);
  }, [showStopConfirmDialog]);

  return (
    <>
      <div className={clsx(styles.actions, compact && styles.actionsCompactRow)}>
        {!compact ? (
          <button
            className={styles.ghostButton}
            onClick={onExitSession}
            type="button"
          >
            Back
          </button>
        ) : null}
        {externalHostProcessControlsEnabled && sessionStatus === "running" && !shouldPutStopInMenu ? (
          <button
            className={clsx(styles.dangerButton, compact && styles.dangerButtonCompact)}
            disabled={isStopping}
            onClick={handleStopSession}
            type="button"
          >
            {isStopping ? "Stopping..." : "Stop"}
          </button>
        ) : null}
        {renderUtilityMenu()}
      </div>
      <ConfirmDialog
        confirmLabel="Stop session"
        confirmingLabel="Stopping..."
        description={`The local ${adapterLabel} run will be stopped.`}
        isConfirming={isStopping}
        isOpen={showStopConfirmDialog}
        title="Stop this session?"
        tone="danger"
        onCancel={() => setShowStopConfirmDialog(false)}
        onConfirm={onStopAndExitSession ? handleStopAndExitSession : handleStopSession}
      />
    </>
  );
}
