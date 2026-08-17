import { useEffect } from "react";

import type { UseLiveOverlayEscapeArgs } from "./types";

export function useLiveOverlayEscape({
  activeLiveOverlay,
  onCloseLiveOverlays
}: UseLiveOverlayEscapeArgs) {
  useEffect(() => {
    if (!activeLiveOverlay) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseLiveOverlays();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeLiveOverlay, onCloseLiveOverlays]);
}
