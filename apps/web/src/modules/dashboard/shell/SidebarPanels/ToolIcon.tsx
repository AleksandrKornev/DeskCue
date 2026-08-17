import ToolAgentsIcon from "@assets/images/icon-tool-agents.svg?react";
import ToolManualIcon from "@assets/images/icon-tool-manual.svg?react";
import ToolRuntimesIcon from "@assets/images/icon-tool-runtimes.svg?react";
import ToolWorkspacesIcon from "@assets/images/icon-tool-workspaces.svg?react";

import type { ToolIconProps } from "./types";

export function ToolIcon({ className, kind }: ToolIconProps) {
  const Icon =
    kind === "manual"
      ? ToolManualIcon
      : kind === "runtimes"
        ? ToolRuntimesIcon
        : kind === "agents"
          ? ToolAgentsIcon
          : ToolWorkspacesIcon;

  return <Icon className={className} focusable="false" />;
}
