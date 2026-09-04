import clsx from "clsx";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import type { AgentSessionSummary } from "@deskcue/protocol";
import ChevronDownIcon from "@assets/images/icon-chevron-down.svg?react";
import SubagentsIcon from "@assets/images/icon-tool-agents.svg?react";
import { AgentRuntimeIcon } from "@components/AgentRuntimeIcon";

import { readSubagentDisplayText, readSubagentStatus } from "./model";
import styles from "./styles.module.scss";
import {
  readSubagentPanelViewState,
  writeSubagentPanelViewState
} from "./viewState";

type SubagentSessionsPanelProps = {
  hasMore: boolean;
  isLoading: boolean;
  loadFailed: boolean;
  parentSessionId: string | null;
  sessions: AgentSessionSummary[];
  onOpenSession: (sessionId: string) => void;
  onRetry: () => void;
};

export function SubagentSessionsPanel({
  hasMore,
  isLoading,
  loadFailed,
  parentSessionId,
  sessions,
  onOpenSession,
  onRetry
}: SubagentSessionsPanelProps) {
  const panelId = useId();
  const [viewState, setViewState] = useState(() => readSubagentPanelViewState(
    typeof window === "undefined" ? null : window.history.state,
    parentSessionId ?? ""
  ));
  const listRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLButtonElement>(null);
  const expanded = viewState.parentSessionId === parentSessionId && viewState.expanded;

  const persistViewState = useCallback((nextViewState: typeof viewState) => {
    setViewState(nextViewState);
    window.history.replaceState(
      writeSubagentPanelViewState(window.history.state, nextViewState),
      ""
    );
  }, []);
  const runningCount = sessions.filter(
    (session) => readSubagentStatus(session).tone === "running"
  ).length;

  useLayoutEffect(() => {
    if (!parentSessionId || viewState.parentSessionId === parentSessionId) return;

    setViewState(readSubagentPanelViewState(window.history.state, parentSessionId));
  }, [parentSessionId, viewState.parentSessionId]);

  useLayoutEffect(() => {
    if (!expanded || !parentSessionId) return;

    const list = listRef.current;

    if (list) list.scrollTop = viewState.scrollTop;

    if (!viewState.returnFocusSessionId) return;

    const returnTarget = list
      ? Array.from(
          list.querySelectorAll<HTMLButtonElement>("[data-subagent-session-id]")
        ).find((button) => button.dataset.subagentSessionId === viewState.returnFocusSessionId)
      : null;
    if (!returnTarget && isLoading) return;

    const focusDelayMs = returnTarget ? 180 : 250;
    const focusTimeoutId = window.setTimeout(() => {
      const currentList = listRef.current;
      const currentTarget = currentList
        ? Array.from(
            currentList.querySelectorAll<HTMLButtonElement>("[data-subagent-session-id]")
          ).find((button) => button.dataset.subagentSessionId === viewState.returnFocusSessionId)
        : null;
      const activeElement = document.activeElement;
      const parentChromeOwnsFocus = activeElement instanceof HTMLButtonElement &&
        (
          activeElement.textContent?.trim() === "Back to chats" ||
          activeElement.textContent?.trim() === "Back to parent" ||
          activeElement.getAttribute("aria-label") === "Back to parent"
        );
      const canRestoreFocus = !activeElement?.isConnected ||
        activeElement === document.body ||
        activeElement === document.documentElement ||
        parentChromeOwnsFocus;

      if (canRestoreFocus && currentTarget) {
        currentTarget.scrollIntoView?.({ block: "nearest" });
        currentTarget.focus({ preventScroll: true });
      } else if (canRestoreFocus) {
        summaryRef.current?.focus({ preventScroll: true });
      }

      if (canRestoreFocus && viewState.windowScrollY !== null) {
        window.scrollTo({
          behavior: "auto",
          left: window.scrollX,
          top: viewState.windowScrollY
        });
      }

      persistViewState({ ...viewState, returnFocusSessionId: null });
    }, focusDelayMs);

    return () => window.clearTimeout(focusTimeoutId);
  }, [expanded, isLoading, parentSessionId, persistViewState, sessions, viewState]);

  if (sessions.length === 0 && !loadFailed) return null;

  if (sessions.length === 0) {
    return (
      <section className={styles.panel} aria-label="Subagents">
        <div className={styles.loadError} role="status">
          <span>Subagents unavailable</span>
          <button className={styles.retryButton} onClick={() => onRetry()} type="button">Retry</button>
        </div>
      </section>
    );
  }

  const totalLabel = hasMore ? `${sessions.length}+ total` : `${sessions.length} total`;

  return (
    <section className={styles.panel} aria-label="Subagents">
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className={styles.summary}
        ref={summaryRef}
        onClick={() => {
          if (!parentSessionId) return;

          persistViewState({
            expanded: !expanded,
            parentSessionId,
            returnFocusSessionId: null,
            scrollTop: expanded ? listRef.current?.scrollTop ?? viewState.scrollTop : 0,
            windowScrollY: viewState.windowScrollY
          });
        }}
        type="button"
      >
        <span className={styles.summaryIdentity}>
          <SubagentsIcon aria-hidden="true" className={styles.summaryIcon} />
          <strong>Subagents</strong>
        </span>
        <span className={styles.summaryMeta}>
          {runningCount > 0 ? <span className={styles.runningCount}>{runningCount} running</span> : null}
          <span>{totalLabel}</span>
          <ChevronDownIcon
            aria-hidden="true"
            className={clsx(styles.chevron, expanded && styles.chevronExpanded)}
          />
        </span>
      </button>

      {expanded ? (
        <div
          className={styles.list}
          id={panelId}
          ref={listRef}
        >
          {sessions.map((session) => {
            const display = readSubagentDisplayText(session);
            const status = readSubagentStatus(session);

            return (
              <button
                aria-label={`Open subagent ${display.label}, ${display.detail}, ${status.label}`}
                className={styles.row}
                data-subagent-session-id={session.id}
                key={session.id}
                onClick={() => {
                  if (parentSessionId) {
                    const returnViewState = {
                      expanded: true,
                      parentSessionId,
                      returnFocusSessionId: session.id,
                      scrollTop: listRef.current?.scrollTop ?? 0,
                      windowScrollY: window.scrollY
                    };

                    window.history.replaceState(
                      writeSubagentPanelViewState(window.history.state, returnViewState),
                      ""
                    );
                  }

                  onOpenSession(session.id);
                }}
                type="button"
              >
                <span className={styles.runtimeIcon} data-chat-runtime-icon={session.agentId}>
                  <AgentRuntimeIcon runtimeId={session.agentId} />
                </span>
                <span className={styles.rowText}>
                  <strong>{display.label}</strong>
                  <span>{display.detail}</span>
                </span>
                <span className={clsx(styles.status, styles[`status_${status.tone}`])}>
                  {status.tone === "running" ? (
                    <span aria-hidden="true" className={styles.statusDot} />
                  ) : null}
                  {status.label}
                </span>
              </button>
            );
          })}
          {hasMore ? (
            <p className={styles.limitNote}>Showing the 100 most recent subagents.</p>
          ) : null}
          {isLoading ? <span className={styles.refreshing}>Refreshing…</span> : null}
          {loadFailed ? (
            <div className={styles.loadError} role="status">
              <span>Couldn’t refresh subagents</span>
              <button className={styles.retryButton} onClick={() => onRetry()} type="button">Retry</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
