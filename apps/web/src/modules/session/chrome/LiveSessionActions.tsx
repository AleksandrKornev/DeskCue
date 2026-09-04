import clsx from "clsx";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
  RefObject,
  SetStateAction
} from "react";

import MoreIcon from "@assets/images/icon-more-horizontal.svg?react";
import { Modal } from "@components/Modal";
import { ConfirmDialog } from "@components/ModalDialog";
import { getDeskCueRuntime } from "@runtime";

import styles from "./styles.module.scss";
import type { LiveSessionActionsProps } from "./types";

type MenuFocusRequest = "first" | "last";
type BooleanStateSetter = Dispatch<SetStateAction<boolean>>;

const MOBILE_ACTION_SHEET_MEDIA_QUERY = "(max-width: 720px)";
const COMPACT_SESSION_ACTIONS_MEDIA_QUERY = "(max-width: 900px), (max-height: 640px)";

type StopSessionOptions = {
  isMountedRef: MutableRefObject<boolean>;
  isStopping: boolean;
  onStopSession: LiveSessionActionsProps["onStopSession"];
  setIsStopping: BooleanStateSetter;
  setShowStopConfirmDialog: BooleanStateSetter;
};

type StopAndExitSessionOptions = StopSessionOptions & {
  onStopAndExitSession: LiveSessionActionsProps["onStopAndExitSession"];
};

class UtilityMenuOutsidePointerListener {
  constructor(
    private readonly utilityMenuRef: RefObject<HTMLDivElement | null>,
    private readonly setShowUtilityMenu: BooleanStateSetter
  ) {}

  handlePointerDown = (event: MouseEvent) => {
    if (!this.utilityMenuRef.current?.contains(event.target as Node)) {
      this.setShowUtilityMenu(false);
    }
  };
}

function readMobileActionSheetViewport() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_ACTION_SHEET_MEDIA_QUERY).matches;
}

function subscribeToMobileActionSheetViewport(handleChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};

  const mediaQuery = window.matchMedia(MOBILE_ACTION_SHEET_MEDIA_QUERY);

  mediaQuery.addEventListener("change", handleChange);

  return () => mediaQuery.removeEventListener("change", handleChange);
}

function useMobileActionSheetViewport() {
  return useSyncExternalStore(
    subscribeToMobileActionSheetViewport,
    readMobileActionSheetViewport,
    () => false
  );
}

function readCompactSessionActionsViewport() {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(COMPACT_SESSION_ACTIONS_MEDIA_QUERY).matches;
}

function subscribeToCompactSessionActionsViewport(handleChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};

  const mediaQuery = window.matchMedia(COMPACT_SESSION_ACTIONS_MEDIA_QUERY);

  mediaQuery.addEventListener("change", handleChange);

  return () => mediaQuery.removeEventListener("change", handleChange);
}

function useCompactSessionActionsViewport() {
  return useSyncExternalStore(
    subscribeToCompactSessionActionsViewport,
    readCompactSessionActionsViewport,
    () => false
  );
}

function requestStopSession({
  isMountedRef,
  isStopping,
  onStopSession,
  setIsStopping,
  setShowStopConfirmDialog
}: StopSessionOptions) {
  if (isStopping) return;

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
}

function requestStopAndExitSession({
  isMountedRef,
  isStopping,
  onStopAndExitSession,
  onStopSession,
  setIsStopping,
  setShowStopConfirmDialog
}: StopAndExitSessionOptions) {
  if (isStopping) return;

  if (!onStopAndExitSession) {
    requestStopSession({
      isMountedRef,
      isStopping,
      onStopSession,
      setIsStopping,
      setShowStopConfirmDialog
    });
    return;
  }

  setIsStopping(true);

  Promise.resolve(onStopAndExitSession()).finally(() => {
    if (isMountedRef.current) {
      setIsStopping(false);
    }
  });
}

function openUtilityMenu(
  focusRequest: MenuFocusRequest,
  menuFocusRequestRef: MutableRefObject<MenuFocusRequest>,
  setShowUtilityMenu: BooleanStateSetter
) {
  menuFocusRequestRef.current = focusRequest;
  setShowUtilityMenu(true);
}

function getEnabledMenuItems(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    .filter((item) => !item.matches(":disabled") && item.getAttribute("aria-disabled") !== "true");
}

function focusMenuBoundary(menu: HTMLElement, boundary: MenuFocusRequest) {
  const items = getEnabledMenuItems(menu);

  items.forEach((item) => { item.tabIndex = -1; });

  const target = boundary === "first" ? items[0] : items.at(-1);

  target?.focus();
}

function focusAdjacentMenuItem(menu: HTMLElement, offset: -1 | 1) {
  const items = getEnabledMenuItems(menu);

  if (items.length === 0) return;

  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  const nextIndex = currentIndex < 0
    ? offset > 0 ? 0 : items.length - 1
    : (currentIndex + offset + items.length) % items.length;

  items[nextIndex]?.focus();
}

function handleUtilityMenuTriggerKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  menuFocusRequestRef: MutableRefObject<MenuFocusRequest>,
  setShowUtilityMenu: BooleanStateSetter
) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  event.preventDefault();
  openUtilityMenu(
    event.key === "ArrowDown" ? "first" : "last",
    menuFocusRequestRef,
    setShowUtilityMenu
  );
}

function handleUtilityMenuKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  utilityMenuPopoverRef: RefObject<HTMLDivElement | null>,
  utilityMenuTriggerRef: RefObject<HTMLButtonElement | null>,
  closeOnTab: boolean,
  setShowUtilityMenu: BooleanStateSetter
) {
  const menu = utilityMenuPopoverRef.current;

  if (!menu) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    setShowUtilityMenu(false);
    utilityMenuTriggerRef.current?.focus();
    return;
  }

  if (event.key === "Tab") {
    if (closeOnTab) setShowUtilityMenu(false);
    return;
  }

  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    focusMenuBoundary(menu, event.key === "Home" ? "first" : "last");
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    focusAdjacentMenuItem(menu, event.key === "ArrowDown" ? 1 : -1);
  }
}

function handleUtilityMenuClick(
  event: ReactMouseEvent<HTMLDivElement>,
  utilityMenuTriggerRef: RefObject<HTMLButtonElement | null>,
  setShowUtilityMenu: BooleanStateSetter
) {
  const target = event.target;

  if (target instanceof Element && target.closest('[role="menuitem"]')) {
    utilityMenuTriggerRef.current?.focus();
    setShowUtilityMenu(false);
  }
}

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
  const isMobileActionSheet = useMobileActionSheetViewport();
  const compactSessionActionsViewport = useCompactSessionActionsViewport();
  const isCompactSessionActions = compact || compactSessionActionsViewport;
  const [showUtilityMenu, setShowUtilityMenu] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [showStopConfirmDialog, setShowStopConfirmDialog] = useState(false);

  const utilityMenuId = useId();
  const utilityMenuTriggerId = `${utilityMenuId}-trigger`;
  const utilityMenuRef = useRef<HTMLDivElement | null>(null);
  const utilityMenuPopoverRef = useRef<HTMLDivElement | null>(null);
  const utilityMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedDesktopActionRef = useRef(false);
  const lastFocusedDesktopStopRef = useRef(false);
  const menuFocusRequestRef = useRef<MenuFocusRequest>("first");
  const mobileActionSheetRef = useRef(isMobileActionSheet);
  const previousCompactSessionActionsRef = useRef(isCompactSessionActions);
  const isMountedRef = useRef(true);

  const shouldPutStopInMenu =
    externalHostProcessControlsEnabled && isCompactSessionActions && sessionStatus === "running";
  const showDesktopStop =
    externalHostProcessControlsEnabled && sessionStatus === "running" && !shouldPutStopInMenu;
  const previousDesktopStopVisibleRef = useRef(showDesktopStop);
  const hasUtilityActions = Boolean(
    shouldPutStopInMenu ||
      (externalHostProcessControlsEnabled && canStopExternalClaudeBackground) ||
      onToggleModelContext ||
      onOpenDiagnostics ||
      onToggleTools ||
      extraMenuItem
  );

  const utilityMenuItems = (
    <>
      {extraMenuItem}
      {onToggleModelContext ? (
        <button
          className={styles.actionMenuItem}
          onClick={() => {
            setShowUtilityMenu(false);
            onToggleModelContext();
          }}
          role="menuitem"
          tabIndex={-1}
          type="button"
        >
          Model & runtime
        </button>
      ) : null}
      {onToggleTools ? (
        <button
          className={styles.actionMenuItem}
          onClick={() => {
            setShowUtilityMenu(false);
            onToggleTools({ replace: isMobileActionSheet });
          }}
          role="menuitem"
          tabIndex={-1}
          type="button"
        >
          {showTools ? "Hide tools" : "Tools"}
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
          tabIndex={-1}
          type="button"
        >
          Diagnostics
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
          tabIndex={-1}
          type="button"
        >
          Stop Claude background job
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
          tabIndex={-1}
          type="button"
        >
          {isStopping ? "Stopping..." : "Stop session"}
        </button>
      ) : null}
    </>
  );
  const utilityMenu = hasUtilityActions ? (
      <div className={styles.actionMenu} ref={utilityMenuRef}>
        <button
          aria-controls={showUtilityMenu ? utilityMenuId : undefined}
          aria-expanded={showUtilityMenu}
          aria-haspopup={isMobileActionSheet ? "dialog" : "menu"}
          aria-label="More actions"
          className={clsx(
            styles.ghostButton,
            styles.iconUtilityButton,
            (showUtilityMenu || showTools) && styles.activeButton
          )}
          onClick={() => {
            if (showUtilityMenu) {
              setShowUtilityMenu(false);
            } else {
              openUtilityMenu("first", menuFocusRequestRef, setShowUtilityMenu);
            }
          }}
          onKeyDown={(event) => {
            handleUtilityMenuTriggerKeyDown(event, menuFocusRequestRef, setShowUtilityMenu);
          }}
          onFocus={() => {
            lastFocusedDesktopActionRef.current = false;
            lastFocusedDesktopStopRef.current = false;
          }}
          id={utilityMenuTriggerId}
          ref={utilityMenuTriggerRef}
          type="button"
        >
          <MoreIcon className={styles.iconUtilitySvg} aria-hidden="true" focusable="false" />
        </button>

        {showUtilityMenu && !isMobileActionSheet ? (
          <div
            className={styles.actionMenuPopover}
            id={utilityMenuId}
            aria-labelledby={utilityMenuTriggerId}
            ref={utilityMenuPopoverRef}
            role="menu"
            onClick={(event) => {
              handleUtilityMenuClick(
                event,
                utilityMenuTriggerRef,
                setShowUtilityMenu
              );
            }}
            onKeyDown={(event) => {
              handleUtilityMenuKeyDown(
                event,
                utilityMenuPopoverRef,
                utilityMenuTriggerRef,
                true,
                setShowUtilityMenu
              );
            }}
          >
            {utilityMenuItems}
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

  useLayoutEffect(() => {
    if (!showUtilityMenu || !utilityMenuPopoverRef.current) return;

    const menu = utilityMenuPopoverRef.current;
    const enabledItems = getEnabledMenuItems(menu);

    enabledItems.forEach((item) => { item.tabIndex = -1; });

    if (!enabledItems.includes(document.activeElement as HTMLElement)) {
      focusMenuBoundary(menu, menuFocusRequestRef.current);
    }

    menuFocusRequestRef.current = "first";
  });

  useEffect(() => {
    if (!showUtilityMenu || isMobileActionSheet) return;

    const listener = new UtilityMenuOutsidePointerListener(
      utilityMenuRef,
      setShowUtilityMenu
    );

    window.addEventListener("mousedown", listener.handlePointerDown);

    return () => {
      window.removeEventListener("mousedown", listener.handlePointerDown);
    };
  }, [isMobileActionSheet, showUtilityMenu]);

  useLayoutEffect(() => {
    if (mobileActionSheetRef.current === isMobileActionSheet) return;

    mobileActionSheetRef.current = isMobileActionSheet;

    if (!showUtilityMenu) return;

    setShowUtilityMenu(false);
    utilityMenuTriggerRef.current?.focus();
  }, [isMobileActionSheet, showUtilityMenu]);

  useLayoutEffect(() => {
    const wasCompact = previousCompactSessionActionsRef.current;
    const wasDesktopStopVisible = previousDesktopStopVisibleRef.current;
    const compactedFocusedDesktopAction = !wasCompact &&
      isCompactSessionActions &&
      lastFocusedDesktopActionRef.current;
    const removedFocusedDesktopStop = wasDesktopStopVisible &&
      !showDesktopStop &&
      lastFocusedDesktopStopRef.current;

    previousCompactSessionActionsRef.current = isCompactSessionActions;
    previousDesktopStopVisibleRef.current = showDesktopStop;

    if ((!compactedFocusedDesktopAction && !removedFocusedDesktopStop) || document.activeElement !== document.body) return;

    lastFocusedDesktopActionRef.current = false;
    lastFocusedDesktopStopRef.current = false;
    utilityMenuTriggerRef.current?.focus();
  }, [isCompactSessionActions, showDesktopStop]);

  useEffect(() => {
    if (!showStopConfirmDialog) {
      return;
    }

    setShowUtilityMenu(false);
  }, [showStopConfirmDialog]);

  return (
    <>
      <div className={clsx(styles.actions, isCompactSessionActions && styles.actionsCompactRow)}>
        {!isCompactSessionActions ? (
          <button
            className={styles.ghostButton}
            onBlur={() => {
              lastFocusedDesktopActionRef.current = false;
              lastFocusedDesktopStopRef.current = false;
            }}
            onClick={onExitSession}
            onFocus={() => {
              lastFocusedDesktopActionRef.current = true;
              lastFocusedDesktopStopRef.current = false;
            }}
            type="button"
          >
            Back
          </button>
        ) : null}
        {showDesktopStop ? (
          <button
            className={clsx(
              styles.dangerButton,
              isCompactSessionActions && styles.dangerButtonCompact
            )}
            disabled={isStopping}
            onBlur={() => {
              lastFocusedDesktopActionRef.current = false;
              lastFocusedDesktopStopRef.current = false;
            }}
            onClick={() => {
              requestStopSession({
                isMountedRef,
                isStopping,
                onStopSession,
                setIsStopping,
                setShowStopConfirmDialog
              });
            }}
            onFocus={() => {
              lastFocusedDesktopActionRef.current = true;
              lastFocusedDesktopStopRef.current = true;
            }}
            type="button"
          >
            {isStopping ? "Stopping..." : "Stop"}
          </button>
        ) : null}
        {utilityMenu}
      </div>
      <Modal
        bodyClassName={styles.actionSheetBody}
        closeLabel="Close session actions"
        closeOnHistoryBack
        isOpen={showUtilityMenu && isMobileActionSheet}
        title="Session actions"
        onClose={() => setShowUtilityMenu(false)}
      >
        <div
          aria-label="More actions"
          className={styles.actionSheetMenu}
          id={utilityMenuId}
          ref={utilityMenuPopoverRef}
          role="menu"
          onClick={(event) => {
            handleUtilityMenuClick(event, utilityMenuTriggerRef, setShowUtilityMenu);
          }}
          onKeyDown={(event) => {
            handleUtilityMenuKeyDown(
              event,
              utilityMenuPopoverRef,
              utilityMenuTriggerRef,
              false,
              setShowUtilityMenu
            );
          }}
        >
          {utilityMenuItems}
        </div>
      </Modal>
      <ConfirmDialog
        confirmLabel="Stop session"
        confirmingLabel="Stopping..."
        description={`The local ${adapterLabel} run will be stopped.`}
        isConfirming={isStopping}
        isOpen={showStopConfirmDialog}
        title="Stop this session?"
        tone="danger"
        onCancel={() => setShowStopConfirmDialog(false)}
        onConfirm={() => {
          requestStopAndExitSession({
            isMountedRef,
            isStopping,
            onStopAndExitSession,
            onStopSession,
            setIsStopping,
            setShowStopConfirmDialog
          });
        }}
      />
    </>
  );
}
