import { useLayoutEffect, useRef } from "react";

import type { AgentSessionsMobileLayoutProps } from "@modules/agents/types";

import { focusAgentBrowserReturnTarget } from "./focusAgentBrowserReturnTarget";
import { MobileAgentSessionDetail } from "./MobileAgentSessionDetail";

export function AgentSessionsMobileLayout(props: AgentSessionsMobileLayoutProps) {
  const {
    agentSessionId,
    agentSessionLabel,
    parentSessionId,
    sessionsList,
    showFocusedDetail,
    transcriptPanel,
    onBackToParent,
    onBackToChats
  } = props;
  const lastFocusedAgentSessionIdRef = useRef("");
  const returnFocusScopeRef = useRef<ParentNode | null>(null);
  const wasFocusedDetailRef = useRef(false);

  useLayoutEffect(() => {
    if (showFocusedDetail) {
      if (agentSessionId) lastFocusedAgentSessionIdRef.current = agentSessionId;
      wasFocusedDetailRef.current = true;
      return;
    }

    if (!wasFocusedDetailRef.current) return;

    wasFocusedDetailRef.current = false;
    focusAgentBrowserReturnTarget(
      lastFocusedAgentSessionIdRef.current,
      returnFocusScopeRef.current ?? document
    );
  }, [agentSessionId, showFocusedDetail]);

  if (!showFocusedDetail) {
    return sessionsList;
  }

  return (
    <MobileAgentSessionDetail
      agentSessionId={agentSessionId}
      agentSessionLabel={agentSessionLabel}
      parentSessionId={parentSessionId}
      transcriptPanel={transcriptPanel}
      onBackToParent={onBackToParent}
      onBackToChats={(focusOrigin) => {
        returnFocusScopeRef.current =
          focusOrigin.closest<HTMLElement>("[data-agent-browser-focus-root]") ??
          focusOrigin.closest<HTMLElement>("[data-deskcue-remote-root]") ??
          document;
        onBackToChats();
      }}
    />
  );
}
