import type { OverlayMode } from "@models/dashboardRoute";

export type UseLiveOverlayEscapeArgs = {
  activeLiveOverlay: OverlayMode;
  onCloseLiveOverlays: () => void;
};
