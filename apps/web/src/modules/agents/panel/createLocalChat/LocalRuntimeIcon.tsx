import type { LocalLlmRuntimeId } from "@deskcue/protocol";
import { AgentRuntimeIcon } from "@components/AgentRuntimeIcon";

export type LocalRuntimeIconProps = {
  runtimeId: LocalLlmRuntimeId;
};

export function LocalRuntimeIcon({ runtimeId }: LocalRuntimeIconProps) {
  return <AgentRuntimeIcon runtimeId={runtimeId} />;
}
