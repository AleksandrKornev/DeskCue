import { useEffect, useState } from "react";

import { COMPACT_CHAT_MEDIA_QUERY } from "@modules/session/chat/scroll/constants";

export function useCompactChatViewport() {
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(COMPACT_CHAT_MEDIA_QUERY).matches : false
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_CHAT_MEDIA_QUERY);
    const syncViewport = () => setIsCompactViewport(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  return isCompactViewport;
}
