import { useCallback, useState } from "react";

import type { ConversationActivity } from "@modules/session/types";

import { readManagedSessionActivityExpansionKey } from "./activity/helpers";

export function useManagedSessionActivityExpansion() {
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const [collapsedDefaultActivityIds, setCollapsedDefaultActivityIds] = useState<string[]>([]);

  const resetActivityExpansion = useCallback(() => {
    setExpandedActivityId(null);
    setCollapsedDefaultActivityIds([]);
  }, []);

  const toggleActivityGroup = useCallback((activity: ConversationActivity) => {
    const expansionKey = readManagedSessionActivityExpansionKey(activity);
    if (activity.kind === "changes") {
      setCollapsedDefaultActivityIds((current) =>
        current.includes(expansionKey)
          ? current.filter((existingId) => existingId !== expansionKey)
          : [...current, expansionKey]
      );
      return;
    }

    setExpandedActivityId((current) => current === expansionKey ? null : expansionKey);
  }, []);

  const isActivityExpanded = useCallback(
    (activity: ConversationActivity) =>
      activity.kind === "changes"
        ? !collapsedDefaultActivityIds.includes(readManagedSessionActivityExpansionKey(activity))
        : expandedActivityId === readManagedSessionActivityExpansionKey(activity),
    [collapsedDefaultActivityIds, expandedActivityId]
  );

  return {
    isActivityExpanded,
    resetActivityExpansion,
    toggleActivityGroup
  };
}
