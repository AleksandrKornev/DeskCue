import { useMemo, useRef } from "react";

import {
  buildAgentChatWorkIndicator,
  buildManagedChatWorkIndicator,
  buildPendingPromptChatWorkIndicator,
  getWorkIndicatorPriority
} from "@models/agentChatWorkState";
import type {
  AgentSessionsPanelProps,
  AgentSessionWorkIndicator
} from "@modules/agents/types";

import { isAgentSessionReviewed } from "./helpers";

export function useAgentSessionsAttentionState({
  agentSessions,
  cacheScopeKey = "default",
  managedSessions,
  pendingChatPrompt,
  readyForReviewAgentSessionIds
}: Pick<
  AgentSessionsPanelProps,
  "agentSessions" | "managedSessions" | "pendingChatPrompt" | "readyForReviewAgentSessionIds"
> & { cacheScopeKey?: string }) {
  const attentionSessionCacheRef = useRef(
    {
      scopeKey: cacheScopeKey,
      sessions: new Map<string, AgentSessionsPanelProps["agentSessions"][number]>()
    }
  );

  if (attentionSessionCacheRef.current.scopeKey !== cacheScopeKey) {
    attentionSessionCacheRef.current = {
      scopeKey: cacheScopeKey,
      sessions: new Map()
    };
  }

  const workIndicatorsBySourceSessionId = useMemo(() => {
    const indicators = new Map<string, AgentSessionWorkIndicator>();

    for (const session of managedSessions) {
      if (!session.sourceSessionId) continue;

      const existing = indicators.get(session.sourceSessionId);
      const nextIndicator = buildManagedChatWorkIndicator(session);

      if (!nextIndicator) continue;

      if (!existing || getWorkIndicatorPriority(nextIndicator) > getWorkIndicatorPriority(existing)) {
        indicators.set(session.sourceSessionId, nextIndicator);
      }
    }

    const pendingPromptIndicator = buildPendingPromptChatWorkIndicator(pendingChatPrompt);

    if (pendingPromptIndicator && pendingChatPrompt?.sourceSessionId) {
      const existing = indicators.get(pendingChatPrompt.sourceSessionId);

      if (
        !existing ||
        getWorkIndicatorPriority(pendingPromptIndicator) > getWorkIndicatorPriority(existing)
      ) {
        indicators.set(pendingChatPrompt.sourceSessionId, pendingPromptIndicator);
      }
    }

    for (const session of agentSessions) {
      const nextIndicator = buildAgentChatWorkIndicator(session);

      if (!session.sourceSessionId || !nextIndicator) continue;

      const existing = indicators.get(session.sourceSessionId);

      if (!existing || getWorkIndicatorPriority(nextIndicator) > getWorkIndicatorPriority(existing)) {
        indicators.set(session.sourceSessionId, nextIndicator);
      }
    }

    return indicators;
  }, [agentSessions, managedSessions, pendingChatPrompt]);

  const approvalRequestedSourceSessionIds = useMemo(
    () =>
      new Set(
        managedSessions.flatMap((session) =>
          session.actionRequest && session.sourceSessionId ? [session.sourceSessionId] : []
        )
      ),
    [managedSessions]
  );
  const effectiveReadyForReviewAgentSessionIds = useMemo(() => {
    const readySessionIds = new Set(
      readyForReviewAgentSessionIds.filter((sessionId) => {
        const session = agentSessions.find((item) => item.id === sessionId);

        return !session || !isAgentSessionReviewed(session);
      })
    );
    const completedSourceSessionIds = new Set(
      managedSessions.flatMap((session) =>
        session.sourceSessionId &&
        session.status !== "running" &&
        session.finishedAt &&
        !session.actionRequest &&
        session.replyState.phase === "idle"
          ? [session.sourceSessionId]
          : []
      )
    );

    for (const session of agentSessions) {
      if (
        session.workState !== "running" &&
        !isAgentSessionReviewed(session) &&
        completedSourceSessionIds.has(session.sourceSessionId)
      ) {
        readySessionIds.add(session.id);
      }
    }

    return readySessionIds;
  }, [agentSessions, managedSessions, readyForReviewAgentSessionIds]);

  const attentionSessions = useMemo(() => {
    const cache = attentionSessionCacheRef.current.sessions;

    for (const session of agentSessions) {
      const hasWorkIndicator =
        workIndicatorsBySourceSessionId.has(session.sourceSessionId) ||
        session.workState === "running";
      const isReadyForReview = effectiveReadyForReviewAgentSessionIds.has(session.id);
      const hasAttentionState =
        hasWorkIndicator ||
        isReadyForReview ||
        approvalRequestedSourceSessionIds.has(session.sourceSessionId);

      if (hasAttentionState) {
        cache.set(session.id, session);
      } else {
        cache.delete(session.id);
      }
    }

    return Array.from(cache.values())
      .filter((session) =>
        workIndicatorsBySourceSessionId.has(session.sourceSessionId) ||
        session.workState === "running" ||
        effectiveReadyForReviewAgentSessionIds.has(session.id) ||
        approvalRequestedSourceSessionIds.has(session.sourceSessionId)
      )
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [
    agentSessions,
    approvalRequestedSourceSessionIds,
    effectiveReadyForReviewAgentSessionIds,
    workIndicatorsBySourceSessionId
  ]);

  return {
    approvalRequestedSourceSessionIds,
    attentionSessions,
    effectiveReadyForReviewAgentSessionIds,
    workIndicatorsBySourceSessionId
  };
}
