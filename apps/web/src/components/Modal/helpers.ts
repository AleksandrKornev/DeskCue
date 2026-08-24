import { FOCUSABLE_ELEMENT_SELECTOR } from "./constants";

export function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENT_SELECTOR))
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

export function createModalKeyDownHandler(
  dialogRef: { current: HTMLDivElement | null },
  onCloseRef: { current: () => void }
) {
  return (event: KeyboardEvent) => {
    if (event.key === "Escape") {
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
    } else if (!event.shiftKey && (activeElement === lastElement || !focusIsInsideDialog)) {
      event.preventDefault();
      firstElement?.focus();
    }
  };
}

export function createModalPopStateHandler(
  historyEntryActiveRef: { current: boolean },
  onCloseRef: { current: () => void }
) {
  return () => {
    historyEntryActiveRef.current = false;
    onCloseRef.current();
  };
}

export function readHistoryState() {
  const state: unknown = window.history.state;

  return state && typeof state === "object"
    ? state as Record<string, unknown>
    : {};
}
