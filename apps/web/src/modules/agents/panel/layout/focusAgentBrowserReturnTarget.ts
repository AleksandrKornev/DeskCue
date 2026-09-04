export function focusAgentBrowserReturnTarget(agentSessionId: string, scope: ParentNode = document) {
  if (document.activeElement !== document.body) return;

  const exactTarget = Array.from(
    scope.querySelectorAll<HTMLElement>("[data-chat-list-item-id]")
  ).find((element) => element.dataset.chatListItemId === agentSessionId);
  const priorityFallbackTarget = scope.querySelector<HTMLElement>(
    "[data-chat-list-focus-fallback][data-chat-list-focus-priority]"
  );
  const fallbackTarget = priorityFallbackTarget ??
    scope.querySelector<HTMLElement>("[data-chat-list-focus-fallback]");

  (exactTarget ?? fallbackTarget)?.focus({ preventScroll: true });
}
