import { AgentSessionsPanelSurface } from "./AgentSessionsPanelSurface";
import { AgentSessionsSkeleton } from "./AgentSessionsSkeleton";

export function AgentSessionsPanelLoading() {
  return (
    <AgentSessionsPanelSurface>
      <AgentSessionsSkeleton />
    </AgentSessionsPanelSurface>
  );
}
