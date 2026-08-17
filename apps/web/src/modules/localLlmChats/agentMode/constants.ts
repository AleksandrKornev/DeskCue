import type { LocalLlmAgentMode } from "./localLlmAgentMode.types";

export const MODE_COPY: Record<
  LocalLlmAgentMode,
  { detail: string; label: string }
> = {
  read_only: {
    detail: "Can inspect the linked workspace without changing files or running write commands",
    label: "Read-only"
  },
  ask: {
    detail: "DeskCue asks before file edits and commands that need permission",
    label: "Ask first"
  },
  auto_workspace: {
    detail: "Can work automatically inside the linked workspace",
    label: "Auto workspace"
  },
  full_access: {
    detail: "Runs changes and commands on this trusted machine with no sandbox — DeskCue records each action and result in this chat",
    label: "Full access"
  }
};
