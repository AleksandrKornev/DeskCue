import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveAgentChatTranscriptDetail } from "@modules/dashboard/model/chatDetail/requests/agentChatDetailRequests";

import { agentChatDetailResource } from "./agentChatDetailResource";
import { createInitialSnapshot } from "./agentChatDetailState";
import type {
  AgentChatDetailHookLoadOptions,
  AgentChatDetailResourceSnapshot,
  UseAgentChatDetailResourceArgs
} from "./agentChatDetailTypes";

export function useAgentChatDetailResource({
  activeTab,
  enabled = true,
  minimumUpdatedAt,
  onDetail,
  reason = "initial",
  refreshKey,
  sessionId,
  summaryOnOverview = true,
  transcriptDetail
}: UseAgentChatDetailResourceArgs) {
  const onDetailRef = useRef(onDetail);
  const resolvedTranscriptDetail = useMemo(
    () => transcriptDetail ?? resolveAgentChatTranscriptDetail(activeTab, { summaryOnOverview }),
    [activeTab, summaryOnOverview, transcriptDetail]
  );
  const [snapshot, setSnapshot] = useState<AgentChatDetailResourceSnapshot>(() =>
    sessionId ? agentChatDetailResource.readSnapshot(sessionId) : createInitialSnapshot("")
  );

  useEffect(() => {
    onDetailRef.current = onDetail;
  }, [onDetail]);

  useEffect(() => {
    if (!sessionId) {
      setSnapshot(createInitialSnapshot(""));
      return () => undefined;
    }

    setSnapshot(agentChatDetailResource.readSnapshot(sessionId));
    return agentChatDetailResource.subscribe(sessionId, () => {
      setSnapshot(agentChatDetailResource.readSnapshot(sessionId));
    });
  }, [sessionId]);

  const load = useCallback(async (loadOptions: AgentChatDetailHookLoadOptions = {}) => {
    if (!sessionId) {
      onDetailRef.current?.(null, "");
      return null;
    }

    const requestSessionId = sessionId;
    const detail = await agentChatDetailResource.loadDetail(sessionId, {
      activeTab,
      minimumUpdatedAt: loadOptions.minimumUpdatedAt ?? minimumUpdatedAt,
      reason: loadOptions.reason ?? reason,
      retry: loadOptions.retry ?? true,
      transcriptDetail: resolvedTranscriptDetail,
      ...(loadOptions.bypassDedupe === undefined
        ? {}
        : { bypassDedupe: loadOptions.bypassDedupe }),
      ...(loadOptions.force === undefined ? {} : { force: loadOptions.force })
    });
    onDetailRef.current?.(detail, requestSessionId);
    return detail;
  }, [activeTab, minimumUpdatedAt, reason, resolvedTranscriptDetail, sessionId]);

  const refresh = useCallback(
    (loadOptions: AgentChatDetailHookLoadOptions = {}) =>
      load({
        ...loadOptions,
        force: true,
        reason: loadOptions.reason ?? "manual",
        retry: loadOptions.retry ?? true
      }),
    [load]
  );

  useEffect(() => {
    if (!enabled || !sessionId) {
      return () => undefined;
    }

    const abortController = new AbortController();
    const requestSessionId = sessionId;
    agentChatDetailResource.loadDetail(sessionId, {
      activeTab,
      minimumUpdatedAt,
      reason,
      retry: true,
      signal: abortController.signal,
      transcriptDetail: resolvedTranscriptDetail
    })
      .then((detail) => {
        if (!abortController.signal.aborted) {
          onDetailRef.current?.(detail, requestSessionId);
        }
      })
      .catch(() => undefined);

    return () => {
      abortController.abort();
    };
  }, [
    activeTab,
    enabled,
    minimumUpdatedAt,
    reason,
    refreshKey,
    resolvedTranscriptDetail,
    sessionId
  ]);

  return {
    detail: snapshot.detail,
    load,
    refresh,
    snapshot,
    transcriptDetail: resolvedTranscriptDetail
  };
}
