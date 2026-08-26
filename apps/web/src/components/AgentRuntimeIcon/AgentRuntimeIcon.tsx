import type { SVGProps } from "react";

import ClaudeLogo from "@assets/images/logo-claude.svg?react";
import LmStudioLogo from "@assets/images/logo-lm-studio.svg?react";
import OllamaLogo from "@assets/images/logo-ollama.svg?react";
import OpenAiLogo from "@assets/images/logo-openai.svg?react";

function GenericCliIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} fill="none" viewBox="0 0 24 24">
      <rect height="16" rx="3" stroke="currentColor" strokeWidth="1.8" width="20" x="2" y="4" />
      <path
        d="m7 9 3 3-3 3M12.5 15H17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function AgentRuntimeIcon({
  runtimeId,
  ...props
}: SVGProps<SVGSVGElement> & { runtimeId: string }) {
  const normalizedRuntime = runtimeId.trim().replaceAll("_", "-").toLowerCase();
  const iconProps = {
    ...props,
    "aria-hidden": true,
    "data-runtime-icon": normalizedRuntime,
    focusable: false
  };

  if (normalizedRuntime === "codex") return <OpenAiLogo {...iconProps} />;
  if (normalizedRuntime === "claude-code") return <ClaudeLogo {...iconProps} />;
  if (normalizedRuntime === "ollama") return <OllamaLogo {...iconProps} />;
  if (normalizedRuntime === "lm-studio") return <LmStudioLogo {...iconProps} />;

  return <GenericCliIcon {...iconProps} />;
}
