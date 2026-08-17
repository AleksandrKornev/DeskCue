import type { LocalLlmChatDetail } from "@deskcue/protocol";

export const LOCAL_AGENT_MODE_OPTIONS: Array<{
  description: string;
  id: LocalLlmChatDetail["agentMode"];
  label: string;
}> = [
  {
    id: "full_access",
    label: "Full access",
    description: "Runs changes and commands with no sandbox on this trusted machine"
  },
  {
    id: "auto_workspace",
    label: "Auto workspace",
    description: "Applies file changes automatically and asks before commands"
  },
  {
    id: "ask",
    label: "Ask first",
    description: "Asks before any file change or command"
  },
  {
    id: "read_only",
    label: "Read-only",
    description: "Can inspect the attached workspace without changing it"
  }
];
