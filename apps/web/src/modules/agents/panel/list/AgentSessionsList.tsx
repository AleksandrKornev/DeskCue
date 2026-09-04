import clsx from "clsx";

import { AgentChatBadge, isSubagentChat } from "@components/AgentChatBadge";
import { AgentRuntimeIcon } from "@components/AgentRuntimeIcon";
import { Tooltip } from "@components/Tooltip";
import { formatCompactDate } from "@lib/format";
import { getSourceSessionKey } from "@models/agentChatWorkState";
import styles from "@modules/agents/panel/styles.module.scss";
import type { AgentSessionsListProps } from "@modules/agents/types";

import { AgentSessionsListSkeleton } from "./AgentSessionsListSkeleton";
import type { AgentSessionListStatusIndicator, ChatListItem } from "./types";

export function AgentSessionsList(props: AgentSessionsListProps) {
  const {
    canShowFewerSessions,
    canLoadMoreSessions,
    filteredSessionsCount,
    hiddenSessionsCount,
    isLoading,
    isLoadingMoreSessions,
    totalSessionsCountLabel,
    attachedSourceSessionKeys,
    readyForReviewAgentSessionIds,
    workIndicatorsBySourceSessionKey,
    query,
    selectedAgentSessionId,
    selectedLocalLlmChatId,
    sessions,
    localLlmChats,
    showAllLocalLlmChats = false,
    title,
    onSelectAgentSession,
    onOpenLocalLlmChat,
    onShowFewerSessions,
    onShowMoreSessions
  } = props;

  const chatItems = [
    ...sessions.map((session): ChatListItem => ({ kind: "agent", updatedAt: session.updatedAt, session })),
    ...localLlmChats.map((chat): ChatListItem => ({ kind: "local", updatedAt: chat.updatedAt, chat }))
  ]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, showAllLocalLlmChats ? Number.MAX_SAFE_INTEGER : Math.max(sessions.length, 8));
  const summaryLabel = isLoading
    ? "Loading chats"
    : title
      ? `${chatItems.length} recent chats`
      : hiddenSessionsCount > 0 || canLoadMoreSessions
      ? `Showing ${chatItems.length} of ${totalSessionsCountLabel} chats`
      : `${filteredSessionsCount} chats`;
  const shouldHideEmptyRecentWork = Boolean(title) &&
    !isLoading &&
    chatItems.length === 0 &&
    !canLoadMoreSessions &&
    !canShowFewerSessions;

  if (shouldHideEmptyRecentWork) {
    return (
      <div
        aria-hidden="true"
        className={styles.list}
        data-chat-list-focus-scope=""
      />
    );
  }

  return (
    <div
      aria-busy={isLoading || undefined}
      className={styles.list}
      data-chat-list-focus-scope=""
    >
      {title ? <h3 className={styles.listTitle}>{title}</h3> : null}
      <div
        aria-live="polite"
        className={styles.listSummary}
        data-chat-list-focus-fallback=""
        data-chat-list-focus-priority=""
        tabIndex={-1}
      >
        <span>{summaryLabel}</span>
        {query.trim() ? <span>Filter: {query.trim()}</span> : null}
      </div>

      <div className={styles.listCards}>
        {isLoading ? (
          <AgentSessionsListSkeleton />
        ) : chatItems.map((item) => {
          if (item.kind === "local") {
            const { chat } = item;

            return (
              <button
                key={`local-${chat.id}`}
                className={clsx(
                  styles.listCard,
                  styles.listCardRail,
                  chat.id === selectedLocalLlmChatId && styles.listCardSelected,
                  chat.generationState === "running" && styles.listCardWithWork,
                  chat.generationState === "running" && styles.listCardWithWork_active
                )}
                data-chat-list-item-id={chat.id}
                onClick={() => onOpenLocalLlmChat(chat)}
                type="button"
              >
                <div className={styles.listCardHeader}>
                  <strong>
                    <Tooltip
                      className={styles.listCardTitle}
                      placement="below"
                      value={chat.title}
                    />
                  </strong>
                </div>
                <div className={styles.listCardMeta}>
                  <span className={styles.listCardContext}>
                    <span
                      className={styles.sourcePill}
                      data-chat-runtime-icon={chat.runtimeId}
                    >
                      <AgentRuntimeIcon runtimeId={chat.runtimeId} />
                      {chat.runtimeId === "lm-studio" ? "LM Studio" : "Ollama"}
                    </span>
                  <Tooltip
                    className={styles.listCardWorkspace}
                    placement="below"
                    value={chat.workspace?.name ?? "No workspace linked"}
                  />
                  </span>
                  <span className={styles.listCardActivity}>
                    <span className={styles.listCardDate}>{formatCompactDate(chat.updatedAt)}</span>
                    {chat.generationState === "running" ? (
                      <span className={clsx(styles.workIndicator, styles.workIndicator_active)}>
                        <span aria-hidden="true" className={styles.workIndicatorDot} />
                        <span>Generating</span>
                      </span>
                    ) : null}
                  </span>
                </div>
              </button>
            );
          }

          const { session } = item;
          const workIndicator = workIndicatorsBySourceSessionKey.get(
            getSourceSessionKey(session.agentId, session.sourceSessionId) ?? ""
          );
          const isAttached = attachedSourceSessionKeys.has(
            getSourceSessionKey(session.agentId, session.sourceSessionId) ?? ""
          );
          const isReadyForReview = readyForReviewAgentSessionIds.has(session.id);
          const subagentNickname = session.subagent?.nickname?.trim() || null;
          const sessionDisplayTitle = subagentNickname ?? session.title;
          const subagentDetail = subagentNickname
            ? session.subagent?.role?.trim() || session.title
            : null;
          const shouldShowWorkIndicator =
            workIndicator && !(isReadyForReview && workIndicator.tone === "readonly");
          const statusIndicator: AgentSessionListStatusIndicator | null =
            shouldShowWorkIndicator
              ? workIndicator
              : isAttached
              ? {
                  label: "Attached",
                  tone: "attached" as const,
                  viewerCount: 0,
                  sessionId: session.id
                }
              : isReadyForReview
              ? {
                  label: "New result",
                  tone: "review" as const,
                  viewerCount: 0,
                  sessionId: session.id
                }
              : null;

          return (
            <button
              key={session.id}
              className={clsx(
                styles.listCard,
                styles.listCardRail,
                isAttached && styles.listCardAttached,
                statusIndicator && styles.listCardWithWork,
                statusIndicator && styles[`listCardWithWork_${statusIndicator.tone}`],
                session.id === selectedAgentSessionId && styles.listCardSelected
              )}
              data-chat-list-item-id={session.id}
              onClick={() => onSelectAgentSession(session.id)}
              type="button"
            >
              <div className={styles.listCardHeader}>
                <span className={styles.listCardIdentity}>
                  <strong>
                    <Tooltip
                      className={styles.listCardTitle}
                      placement="below"
                      value={sessionDisplayTitle}
                    />
                  </strong>
                  {subagentDetail ? (
                    <Tooltip
                      className={styles.listCardSubagentDetail}
                      placement="below"
                      value={subagentDetail}
                    />
                  ) : null}
                </span>
              </div>
              <div className={styles.listCardMeta}>
                <span className={styles.listCardContext}>
                  {isSubagentChat(session) ? <AgentChatBadge /> : null}
                  <span
                    className={styles.sourcePill}
                    data-chat-runtime-icon={session.agentId}
                  >
                    <AgentRuntimeIcon runtimeId={session.agentId} />
                    {session.agentLabel}
                  </span>
                  <Tooltip
                    className={styles.listCardWorkspace}
                    placement="below"
                    value={session.workspaceName ?? "No workspace linked"}
                  />
                </span>
                <span className={styles.listCardActivity}>
                  <span
                    className={clsx(styles.listCardDate, statusIndicator && styles.listCardDateWithWork)}
                  >
                    {formatCompactDate(session.updatedAt)}
                  </span>
                  {statusIndicator ? (
                    <span
                      className={clsx(
                        styles.workIndicator,
                        styles[`workIndicator_${statusIndicator.tone}`]
                      )}
                    >
                      <span aria-hidden="true" className={styles.workIndicatorDot} />
                      <span>{statusIndicator.label}</span>
                      {statusIndicator.viewerCount > 0 ? (
                        <span className={styles.workIndicatorCount}>
                          {statusIndicator.viewerCount}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {!isLoading && (canLoadMoreSessions || canShowFewerSessions) ? (
        <button
          className={clsx(styles.button, styles.ghostButton)}
          disabled={isLoadingMoreSessions}
          onClick={canLoadMoreSessions ? onShowMoreSessions : onShowFewerSessions}
          type="button"
        >
          {isLoadingMoreSessions
            ? "Loading chats..."
            : canLoadMoreSessions
              ? hiddenSessionsCount > 0
                ? `Show ${Math.min(hiddenSessionsCount, 24)} more chats`
                : "Load more chats"
              : "Show fewer chats"}
        </button>
      ) : null}
    </div>
  );
}
