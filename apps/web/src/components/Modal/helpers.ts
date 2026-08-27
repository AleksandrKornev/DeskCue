import { FOCUSABLE_ELEMENT_SELECTOR } from "./constants";

const MODAL_HISTORY_MARKER_PREFIX = "deskcue-modal:";
const activeModalHistoryMarkers = new Set<string>();
let modalHistoryCleanupListenerInstalled = false;

export function readHistoryState() {
  const state: unknown = window.history.state;

  return state && typeof state === "object"
    ? state as Record<string, unknown>
    : {};
}

function readModalHistoryMarker() {
  const marker = readHistoryState().deskCueModal;

  return typeof marker === "string" && marker.startsWith(MODAL_HISTORY_MARKER_PREFIX)
    ? marker
    : null;
}

function handleModalHistoryCleanupPopState() {
  const marker = readModalHistoryMarker();

  if (marker && !activeModalHistoryMarkers.has(marker)) {
    window.history.back();
    return;
  }

  window.removeEventListener("popstate", handleModalHistoryCleanupPopState);
  modalHistoryCleanupListenerInstalled = false;
}

export function createModalHistoryMarker(id: string) {
  return `${MODAL_HISTORY_MARKER_PREFIX}${id}`;
}

export function registerModalHistoryMarker(marker: string) {
  activeModalHistoryMarkers.add(marker);
}

export function unregisterModalHistoryMarker(marker: string) {
  activeModalHistoryMarkers.delete(marker);
}

function requestModalHistoryBack() {
  if (!modalHistoryCleanupListenerInstalled) {
    window.addEventListener("popstate", handleModalHistoryCleanupPopState);
    modalHistoryCleanupListenerInstalled = true;
  }

  window.history.back();
}

export function requestInactiveModalHistoryCleanup() {
  const marker = readModalHistoryMarker();

  if (!marker || activeModalHistoryMarkers.has(marker)) return;

  requestModalHistoryBack();
}

function isFocusableElementVisible(element: HTMLElement, containerHasLayout: boolean) {
  const style = window.getComputedStyle(element);

  return style.display !== "none" &&
    style.visibility !== "hidden" &&
    (!containerHasLayout || element.getClientRects().length > 0);
}

export function getFocusableElements(container: HTMLElement) {
  const containerHasLayout = container.getClientRects().length > 0;

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENT_SELECTOR))
    .filter((element) => (
      !element.hidden &&
      !element.hasAttribute("data-modal-focus-guard") &&
      !element.matches(":disabled") &&
      element.tabIndex >= 0 &&
      !element.closest("[aria-hidden='true'], [hidden], [inert]") &&
      isFocusableElementVisible(element, containerHasLayout)
    ));
}

export function createModalFocusInHandler(dialogRef: { current: HTMLElement | null }) {
  return (event: FocusEvent) => {
    const dialog = dialogRef.current;
    const target = event.target;

    if (!dialog) return;

    const focusableElements = getFocusableElements(dialog);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);
    const focusGuard = target instanceof HTMLElement
      ? target.getAttribute("data-modal-focus-guard")
      : null;

    if (focusGuard === "start") {
      (lastElement ?? dialog).focus({ preventScroll: true });
      return;
    }

    if (focusGuard === "end") {
      (firstElement ?? dialog).focus({ preventScroll: true });
      return;
    }

    if (target instanceof Node && dialog.contains(target)) return;

    (firstElement ?? dialog).focus({ preventScroll: true });
  };
}

export function createModalKeyDownHandler(
  dialogRef: { current: HTMLElement | null },
  onCloseRef: { current: () => void }
) {
  return (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
      return;
    }

    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusableElements = getFocusableElements(dialogRef.current);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialogRef.current.focus({ preventScroll: true });
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);
    const activeElement = document.activeElement;
    const focusIsInsideDialog = activeElement instanceof Node &&
      dialogRef.current.contains(activeElement);
    if (
      event.shiftKey &&
      (activeElement === firstElement || activeElement === dialogRef.current || !focusIsInsideDialog)
    ) {
      event.preventDefault();
      lastElement?.focus();
    } else if (
      !event.shiftKey &&
      (activeElement === lastElement || activeElement === dialogRef.current || !focusIsInsideDialog)
    ) {
      event.preventDefault();
      firstElement?.focus();
    }
  };
}

export function createModalPopStateHandler(
  historyEntryActiveRef: { current: boolean },
  onCloseRef: { current: () => void },
  marker: string,
  isTopModal: () => boolean
) {
  return () => {
    if (!historyEntryActiveRef.current) return;
    if (!isTopModal()) return;
    if (readHistoryState().deskCueModal === marker) return;

    historyEntryActiveRef.current = false;
    onCloseRef.current();
    requestInactiveModalHistoryCleanup();
  };
}
