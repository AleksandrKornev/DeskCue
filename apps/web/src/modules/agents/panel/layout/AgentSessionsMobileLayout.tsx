import type { AgentSessionsMobileLayoutProps } from "@modules/agents/types";

import { MobileAgentSessionDetail } from "./MobileAgentSessionDetail";

export function AgentSessionsMobileLayout(props: AgentSessionsMobileLayoutProps) {
  const {
    agentSessionId,
    agentSessionLabel,
    sessionsList,
    showFocusedDetail,
    transcriptPanel,
    onBackToChats
  } = props;

  if (!showFocusedDetail) {
    return sessionsList;
  }

  return (
    <MobileAgentSessionDetail
      agentSessionId={agentSessionId}
      agentSessionLabel={agentSessionLabel}
      transcriptPanel={transcriptPanel}
      onBackToChats={onBackToChats}
    />
  );
}
