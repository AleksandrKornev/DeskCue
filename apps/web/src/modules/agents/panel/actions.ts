import { rememberAgentBrowserListScrollTop } from "./state/agentBrowserListMemory";

export function reviewAndSelectAgentSession(
  sessionId: string,
  rememberScrollPosition: boolean,
  clearSelectedLocalLlmChat: () => void,
  selectAgentSession: (sessionId: string) => void
) {
  if (rememberScrollPosition) rememberAgentBrowserListScrollTop(window.scrollY);

  clearSelectedLocalLlmChat();
  selectAgentSession(sessionId);
}
