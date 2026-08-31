import { useEffect, useLayoutEffect, useRef } from "react";

import { focusAgentBrowserReturnTarget } from "./focusAgentBrowserReturnTarget";

export interface AgentBrowserCompactFocusHandoffOptions {
  focusTargetId: string;
  focusSurfaceKey: string;
  isCompactViewport: boolean;
  showFocusedDetail: boolean;
}

interface MutableValue<TValue> {
  current: TValue;
}

function readAgentBrowserFocusTargetId(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null;

  const exactTarget = target.closest<HTMLElement>("[data-chat-list-item-id]");

  if (exactTarget) return exactTarget.dataset.chatListItemId ?? "";

  const isInsideList = target.closest("[data-chat-list-focus-scope]");
  const isListFallback = target.closest("[data-chat-list-focus-fallback]");
  const ownsListFocus = target.closest("[data-chat-list-focus-owner]");

  return isInsideList || isListFallback || ownsListFocus ? "" : null;
}

function readAgentBrowserFocusScope(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null;

  return target.closest<HTMLElement>("[data-agent-browser-focus-root]") ??
    target.closest<HTMLElement>("[data-deskcue-remote-root]");
}

function isAgentBrowserExplicitFallback(target: EventTarget | null) {
  return target instanceof HTMLElement &&
    Boolean(target.closest("[data-chat-list-focus-fallback]"));
}

class AgentBrowserCompactListFocusTracker implements EventListenerObject {
  constructor(
    private readonly focusedTargetId: MutableValue<string>,
    private readonly focusedScope: MutableValue<ParentNode | null>,
    private readonly shouldRestoreFocus: MutableValue<boolean>
  ) {}

  handleEvent(event: Event) {
    const focusScope = readAgentBrowserFocusScope(event.target);
    const focusTargetId = readAgentBrowserFocusTargetId(event.target);

    if (focusScope) this.focusedScope.current = focusScope;
    if (focusTargetId === null) return;

    if (
      focusTargetId ||
      !isAgentBrowserExplicitFallback(event.target) ||
      !this.focusedTargetId.current
    ) {
      this.focusedTargetId.current = focusTargetId;
    }

    this.shouldRestoreFocus.current = true;
  }
}

export function useAgentBrowserCompactFocusHandoff(
  options: AgentBrowserCompactFocusHandoffOptions
) {
  const { focusTargetId, focusSurfaceKey, isCompactViewport, showFocusedDetail } = options;
  const focusedBrowserTargetIdRef = useRef("");
  const focusedBrowserScopeRef = useRef<ParentNode | null>(null);
  const shouldRestoreBrowserFocusRef = useRef(false);
  const previousCompactViewportRef = useRef(isCompactViewport);
  const previousFocusSurfaceKeyRef = useRef(focusSurfaceKey);
  const previousShowFocusedDetailRef = useRef(showFocusedDetail);
  const listFocusTrackerRef = useRef<AgentBrowserCompactListFocusTracker | null>(null);

  if (!listFocusTrackerRef.current) {
    listFocusTrackerRef.current = new AgentBrowserCompactListFocusTracker(
      focusedBrowserTargetIdRef,
      focusedBrowserScopeRef,
      shouldRestoreBrowserFocusRef
    );
  }

  useEffect(() => {
    const focusTracker = listFocusTrackerRef.current;

    if (!focusTracker) return;

    document.addEventListener("focusin", focusTracker);

    return () => {
      document.removeEventListener("focusin", focusTracker);
    };
  }, []);

  useLayoutEffect(() => {
    const layoutChanged = previousCompactViewportRef.current !== isCompactViewport;
    const focusSurfaceChanged = previousFocusSurfaceKeyRef.current !== focusSurfaceKey;
    const detailClosed = previousShowFocusedDetailRef.current && !showFocusedDetail;

    previousCompactViewportRef.current = isCompactViewport;
    previousFocusSurfaceKeyRef.current = focusSurfaceKey;
    previousShowFocusedDetailRef.current = showFocusedDetail;

    if (isCompactViewport && showFocusedDetail) {
      const activeFocusScope = readAgentBrowserFocusScope(document.activeElement);

      if (focusTargetId) focusedBrowserTargetIdRef.current = focusTargetId;
      if (activeFocusScope) focusedBrowserScopeRef.current = activeFocusScope;
      shouldRestoreBrowserFocusRef.current = true;
      return;
    }

    const currentActiveElement = document.activeElement;
    const currentListFocusTargetId = readAgentBrowserFocusTargetId(currentActiveElement);

    if (currentListFocusTargetId !== null) {
      if (
        currentListFocusTargetId ||
        !isAgentBrowserExplicitFallback(currentActiveElement) ||
        !focusedBrowserTargetIdRef.current
      ) {
        focusedBrowserTargetIdRef.current = currentListFocusTargetId;
      }

      focusedBrowserScopeRef.current =
        readAgentBrowserFocusScope(currentActiveElement) ?? document;
      shouldRestoreBrowserFocusRef.current = true;
    }

    if (
      (!layoutChanged && !detailClosed && !focusSurfaceChanged) ||
      !shouldRestoreBrowserFocusRef.current
    ) {
      return;
    }

    focusAgentBrowserReturnTarget(
      focusedBrowserTargetIdRef.current,
      focusedBrowserScopeRef.current ?? document
    );
  }, [focusSurfaceKey, focusTargetId, isCompactViewport, showFocusedDetail]);
}
