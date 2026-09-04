import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

import {
  createModalFocusInHandler,
  createModalKeyDownHandler
} from "./helpers";

type ModalFocusLifecycleOptions<TElement extends HTMLElement> = {
  dialogRef: RefObject<TElement | null>;
  isOpen?: boolean;
  restoreFocusOnClose?: boolean;
  onClose: () => void;
};

type InertElementState = {
  count: number;
  initialInert: boolean;
};

type ModalLifecycleEntry = {
  dialogRef: RefObject<HTMLElement | null>;
  id: symbol;
  previousEntry: ModalLifecycleEntry | null;
  previouslyFocusedElement: HTMLElement | null;
};

type ModalInertRelease = {
  element: HTMLElement;
};

const modalInertStates = new WeakMap<HTMLElement, InertElementState>();
const modalLifecycleStack: ModalLifecycleEntry[] = [];
let initialBodyOverflow = "";
let initialDocumentOverflow = "";
let modalScrollLockCount = 0;

function collectModalBackgroundElements(dialog: HTMLElement) {
  const backgroundElements = new Set<HTMLElement>();
  let currentElement = dialog.parentElement;

  while (currentElement && currentElement !== document.body) {
    const parentElement = currentElement.parentElement;

    if (!parentElement) break;

    for (const sibling of parentElement.children) {
      if (sibling !== currentElement && sibling instanceof HTMLElement) backgroundElements.add(sibling);
    }

    currentElement = parentElement;
  }

  return Array.from(backgroundElements);
}

function createFocusGuard(position: "start" | "end") {
  const guard = document.createElement("span");

  guard.setAttribute("aria-hidden", "true");
  guard.setAttribute("data-modal-focus-guard", position);
  guard.tabIndex = 0;
  guard.style.height = "1px";
  guard.style.opacity = "0";
  guard.style.pointerEvents = "none";
  guard.style.position = "fixed";
  guard.style.width = "1px";

  return guard;
}

function installModalFocusGuards(dialog: HTMLElement) {
  const startGuard = createFocusGuard("start");
  const endGuard = createFocusGuard("end");

  dialog.prepend(startGuard);
  dialog.append(endGuard);

  return () => {
    startGuard.remove();
    endGuard.remove();
  };
}

function focusMainFallback() {
  const main = document.querySelector<HTMLElement>("main, [role='main']");

  if (!main) return;

  if (!main.hasAttribute("tabindex")) main.tabIndex = -1;
  main.focus({ preventScroll: true });
}

function acquireModalScrollLock() {
  if (modalScrollLockCount === 0) {
    initialBodyOverflow = document.body.style.overflow;
    initialDocumentOverflow = document.documentElement.style.overflow;
  }

  modalScrollLockCount += 1;
  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";
}

function releaseModalScrollLock() {
  if (modalScrollLockCount === 0) return;

  modalScrollLockCount -= 1;

  if (modalScrollLockCount > 0) {
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return;
  }

  document.body.style.overflow = initialBodyOverflow;
  document.documentElement.style.overflow = initialDocumentOverflow;
}

function acquireModalInert(element: HTMLElement) {
  const state = modalInertStates.get(element);

  if (state) {
    state.count += 1;
    element.inert = true;
    return;
  }

  modalInertStates.set(element, {
    count: 1,
    initialInert: element.inert
  });
  element.inert = true;
}

function releaseModalInert(element: HTMLElement) {
  const state = modalInertStates.get(element);

  if (!state) return;

  state.count -= 1;

  if (state.count > 0) {
    element.inert = true;
    return;
  }

  element.inert = state.initialInert;
  modalInertStates.delete(element);
}

function setModalBackgroundInert(dialog: HTMLElement) {
  const releases: ModalInertRelease[] = collectModalBackgroundElements(dialog)
    .map((element) => ({ element }));

  for (const { element } of releases) acquireModalInert(element);

  return () => {
    for (const { element } of releases) releaseModalInert(element);
  };
}

function getTopModalEntry() {
  return modalLifecycleStack.at(-1) ?? null;
}

export function isModalEntryTop(entryId: symbol) {
  return getTopModalEntry()?.id === entryId;
}

function removeModalEntry(entry: ModalLifecycleEntry) {
  const entryIndex = modalLifecycleStack.lastIndexOf(entry);

  if (entryIndex >= 0) modalLifecycleStack.splice(entryIndex, 1);
}

function canRestoreModalFocus(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  if (element === document.body || element === document.documentElement) return false;
  if (element.matches(":disabled")) return false;
  if (element.closest("[aria-hidden='true'], [hidden], [inert]")) return false;

  const style = window.getComputedStyle(element);
  const documentHasLayout = document.documentElement.getClientRects().length > 0;

  return style.display !== "none" &&
    style.visibility !== "hidden" &&
    (!documentHasLayout || element.getClientRects().length > 0);
}

function collectModalRestoreTargets(entry: ModalLifecycleEntry) {
  const targets: HTMLElement[] = [];
  const previouslyFocusedElement = entry.previouslyFocusedElement;

  if (canRestoreModalFocus(previouslyFocusedElement)) targets.push(previouslyFocusedElement);

  let candidateEntry = entry.previousEntry;

  while (candidateEntry) {
    const candidateDialog = candidateEntry.dialogRef.current;
    const candidateFocus = candidateEntry.previouslyFocusedElement;

    if (canRestoreModalFocus(candidateDialog)) targets.push(candidateDialog);
    if (canRestoreModalFocus(candidateFocus)) targets.push(candidateFocus);

    candidateEntry = candidateEntry.previousEntry;
  }

  return Array.from(new Set(targets));
}

function focusModalRestoreTarget(entry: ModalLifecycleEntry) {
  const restoreTargets = collectModalRestoreTargets(entry);

  for (const restoreTarget of restoreTargets) {
    restoreTarget.focus({ preventScroll: true });

    if (document.activeElement === restoreTarget) return;
  }

  focusMainFallback();
}

function restoreModalFocus(entry: ModalLifecycleEntry) {
  focusModalRestoreTarget(entry);

  return window.requestAnimationFrame(() => focusModalRestoreTarget(entry));
}

function createTopModalFocusInHandler(
  entry: ModalLifecycleEntry,
  handleModalFocusIn: (event: FocusEvent) => void
) {
  return (event: FocusEvent) => {
    if (getTopModalEntry() === entry) handleModalFocusIn(event);
  };
}

function createTopModalKeyDownHandler(
  entry: ModalLifecycleEntry,
  handleModalKeyDown: (event: KeyboardEvent) => void
) {
  return (event: KeyboardEvent) => {
    if (getTopModalEntry() === entry) handleModalKeyDown(event);
  };
}

export function useModalFocusLifecycle<TElement extends HTMLElement>({
  dialogRef,
  isOpen = true,
  restoreFocusOnClose = true,
  onClose
}: ModalFocusLifecycleOptions<TElement>) {
  const onCloseRef = useRef(onClose);
  const modalEntryIdRef = useRef(Symbol("modal-focus-lifecycle"));
  const restoreFocusOnCloseRef = useRef(restoreFocusOnClose);
  const restoreFocusFrameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    restoreFocusOnCloseRef.current = restoreFocusOnClose;
  }, [onClose, restoreFocusOnClose]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = null;
    }

    const previouslyFocusedElement = document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      document.activeElement !== document.documentElement
      ? document.activeElement
      : null;
    const entry: ModalLifecycleEntry = {
      dialogRef,
      id: modalEntryIdRef.current,
      previousEntry: getTopModalEntry(),
      previouslyFocusedElement
    };

    const handleModalFocusIn = createModalFocusInHandler(dialogRef);
    const handleModalKeyDown = createModalKeyDownHandler(dialogRef, onCloseRef);
    const handleFocusIn = createTopModalFocusInHandler(entry, handleModalFocusIn);
    const handleKeyDown = createTopModalKeyDownHandler(entry, handleModalKeyDown);
    const removeFocusGuards = dialogRef.current
      ? installModalFocusGuards(dialogRef.current)
      : () => undefined;
    const restoreBackground = dialogRef.current
      ? setModalBackgroundInert(dialogRef.current)
      : () => undefined;

    modalLifecycleStack.push(entry);
    acquireModalScrollLock();
    dialogRef.current?.focus({ preventScroll: true });
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      const wasTopModal = getTopModalEntry() === entry;

      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("keydown", handleKeyDown);
      removeModalEntry(entry);
      removeFocusGuards();
      restoreBackground();
      releaseModalScrollLock();

      if (wasTopModal && restoreFocusOnCloseRef.current) {
        restoreFocusFrameRef.current = restoreModalFocus(entry);
      }
    };
  }, [dialogRef, isOpen, onCloseRef]);

  return {
    modalEntryId: modalEntryIdRef.current,
    onCloseRef
  };
}
