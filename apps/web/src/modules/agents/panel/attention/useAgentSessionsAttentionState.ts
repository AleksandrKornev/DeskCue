import { useMemo, useRef } from "react";

import {
  buildAgentChatWorkIndicator,
  buildManagedChatWorkIndicator,
  buildPendingPromptChatWorkIndicator,
  getSourceSessionKey,
  getWorkIndicatorPriority
} from "@models/agentChatWorkState";
import type {
  AgentSessionsPanelProps,
  AgentSessionWorkIndicator
} from "@modules/agents/types";

import { isAgentSessionReviewed } from "./helpers";

function resolvePendingPromptSourceSessionKey(
  pendingChatPrompt: AgentSessionsPanelProps["pendingChatPrompt"],
  managedSessions: AgentSessionsPanelProps["managedSessions"],
  agentSessions: AgentSessionsPanelProps["agentSessions"]
) {
  if (!pendingChatPrompt?.sourceSessionId) return null;

  const managedPromptSession = pendingChatPrompt.sessionId
    ? managedSessions.find((session) => session.id === pendingChatPrompt.sessionId)
    : null;
  if (managedPromptSession) {
    return getSourceSessionKey(managedPromptSession.adapterId, pendingChatPrompt.sourceSessionId);
  }

  const matchingSourceSessionKeys = new Set([
    ...managedSessions
      .filter((session) => session.sourceSessionId === pendingChatPrompt.sourceSessionId)
      .map((session) => getSourceSessionKey(session.adapterId, session.sourceSessionId)),
    ...agentSessions
      .filter((session) => session.sourceSessionId === pendingChatPrompt.sourceSessionId)
      .map((session) => getSourceSessionKey(session.agentId, session.sourceSessionId))
  ].filter((sourceSessionKey): sourceSessionKey is string => Boolean(sourceSessionKey)));

  return matchingSourceSessionKeys.size === 1
    ? matchingSourceSessionKeys.values().next().value ?? null
    : null;
}

export function useAgentSessionsAttentionState({
  agentSessions,
  cacheScopeKey = "default",
  enabled = true,
  managedSessions,
  pendingChatPrompt,
  readyForReviewAgentSessionIds
}: Pick<
  AgentSessionsPanelProps,
  "agentSessions" | "managedSessions" | "pendingChatPrompt" | "readyForReviewAgentSessionIds"
> & { cacheScopeKey?: string; enabled?: boolean }) {
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

  const workIndicatorsBySourceSessionKey = useMemo(() => {
    const indicators = new Map<string, AgentSessionWorkIndicator>();

    if (!enabled) return indicators;

    for (const session of managedSessions) {
      const sourceSessionKey = getSourceSessionKey(session.adapterId, session.sourceSessionId);

      if (!sourceSessionKey) continue;

      const existing = indicators.get(sourceSessionKey);
      const nextIndicator = buildManagedChatWorkIndicator(session);

      if (!nextIndicator) continue;

      if (!existing || getWorkIndicatorPriority(nextIndicator) > getWorkIndicatorPriority(existing)) {
        indicators.set(sourceSessionKey, nextIndicator);
      }
    }

    const pendingPromptIndicator = buildPendingPromptChatWorkIndicator(pendingChatPrompt);
    const pendingPromptSourceSessionKey = resolvePendingPromptSourceSessionKey(
      pendingChatPrompt,
      managedSessions,
      agentSessions
    );

    if (pendingPromptIndicator && pendingPromptSourceSessionKey) {
      const existing = indicators.get(pendingPromptSourceSessionKey);

      if (
        !existing ||
        getWorkIndicatorPriority(pendingPromptIndicator) > getWorkIndicatorPriority(existing)
      ) {
        indicators.set(pendingPromptSourceSessionKey, pendingPromptIndicator);
      }
    }

    for (const session of agentSessions) {
      const nextIndicator = buildAgentChatWorkIndicator(session);
      const sourceSessionKey = getSourceSessionKey(session.agentId, session.sourceSessionId);

      if (!sourceSessionKey || !nextIndicator) continue;

      const existing = indicators.get(sourceSessionKey);

      if (!existing || getWorkIndicatorPriority(nextIndicator) > getWorkIndicatorPriority(existing)) {
        indicators.set(sourceSessionKey, nextIndicator);
      }
    }

    return indicators;
  }, [agentSessions, enabled, managedSessions, pendingChatPrompt]);

  const approvalRequestedSourceSessionKeys = useMemo(
    () => enabled
      ? new Set(
        managedSessions.flatMap((session) =>
          session.actionRequest
            ? [getSourceSessionKey(session.adapterId, session.sourceSessionId)].filter(
              (sourceSessionKey): sourceSessionKey is string => Boolean(sourceSessionKey)
            )
            : []
        )
      )
      : new Set<string>(),
    [enabled, managedSessions]
  );

  const agentSessionById = useMemo(
    () => enabled
      ? new Map(agentSessions.map((session) => [session.id, session]))
      : new Map<string, AgentSessionsPanelProps["agentSessions"][number]>(),
    [agentSessions, enabled]
  );

  const effectiveReadyForReviewAgentSessionIds = useMemo(() => {
    if (!enabled) return new Set<string>();

    const readySessionIds = new Set(
      readyForReviewAgentSessionIds.filter((sessionId) => {
        const session = agentSessionById.get(sessionId);

        return !session || !isAgentSessionReviewed(session);
      })
    );
    const completedSourceSessionKeys = new Set(
      managedSessions.flatMap((session) =>
        session.sourceSessionId &&
        session.status !== "running" &&
        session.finishedAt &&
        !session.actionRequest &&
        session.replyState.phase === "idle"
          ? [getSourceSessionKey(session.adapterId, session.sourceSessionId)].filter(
            (sourceSessionKey): sourceSessionKey is string => Boolean(sourceSessionKey)
          )
          : []
      )
    );

    for (const session of agentSessions) {
      if (
        session.workState !== "running" &&
        !isAgentSessionReviewed(session) &&
        completedSourceSessionKeys.has(
          getSourceSessionKey(session.agentId, session.sourceSessionId) ?? ""
        )
      ) {
        readySessionIds.add(session.id);
      }
    }

    return readySessionIds;
  }, [agentSessionById, agentSessions, enabled, managedSessions, readyForReviewAgentSessionIds]);

  const attentionSessions = useMemo(() => {
    if (!enabled) return [];

    const cache = attentionSessionCacheRef.current.sessions;

    for (const session of agentSessions) {
      const hasWorkIndicator =
        workIndicatorsBySourceSessionKey.has(
          getSourceSessionKey(session.agentId, session.sourceSessionId) ?? ""
        ) ||
        session.workState === "running";
      const isReadyForReview = effectiveReadyForReviewAgentSessionIds.has(session.id);
      const hasAttentionState =
        hasWorkIndicator ||
        isReadyForReview ||
        approvalRequestedSourceSessionKeys.has(
          getSourceSessionKey(session.agentId, session.sourceSessionId) ?? ""
        );

      if (hasAttentionState) {
        cache.set(session.id, session);
      } else {
        cache.delete(session.id);
      }
    }

    return Array.from(cache.values())
      .filter((session) =>
        workIndicatorsBySourceSessionKey.has(
          getSourceSessionKey(session.agentId, session.sourceSessionId) ?? ""
        ) ||
        session.workState === "running" ||
        effectiveReadyForReviewAgentSessionIds.has(session.id) ||
        approvalRequestedSourceSessionKeys.has(
          getSourceSessionKey(session.agentId, session.sourceSessionId) ?? ""
        )
      )
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }, [
    agentSessions,
    approvalRequestedSourceSessionKeys,
    enabled,
    effectiveReadyForReviewAgentSessionIds,
    workIndicatorsBySourceSessionKey
  ]);

  return {
    approvalRequestedSourceSessionKeys,
    attentionSessions,
    effectiveReadyForReviewAgentSessionIds,
    workIndicatorsBySourceSessionKey
  };
}
