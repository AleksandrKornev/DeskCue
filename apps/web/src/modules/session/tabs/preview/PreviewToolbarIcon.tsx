import ExternalLinkIcon from "@assets/images/icon-external-link.svg?react";
import ReloadIcon from "@assets/images/icon-reload.svg?react";
import SlidersIcon from "@assets/images/icon-sliders.svg?react";
import StopIcon from "@assets/images/icon-stop.svg?react";

type PreviewToolbarIconProps = {
  kind: "connection" | "open" | "reload" | "stop";
};

export function PreviewToolbarIcon({ kind }: PreviewToolbarIconProps) {
  if (kind === "reload") {
    return <ReloadIcon aria-hidden="true" focusable="false" />;
  }
  if (kind === "connection") {
    return <SlidersIcon aria-hidden="true" focusable="false" />;
  }
  if (kind === "stop") {
    return <StopIcon aria-hidden="true" focusable="false" />;
  }
  return <ExternalLinkIcon aria-hidden="true" focusable="false" />;
}
