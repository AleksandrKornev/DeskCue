import { useEffect, useState } from "react";

import { DASHBOARD_COMPACT_MEDIA_QUERY } from "./constants";

export function useDashboardCompactViewport() {
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(DASHBOARD_COMPACT_MEDIA_QUERY).matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(DASHBOARD_COMPACT_MEDIA_QUERY);
    const syncViewport = () => setIsCompactViewport(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  return isCompactViewport;
}
