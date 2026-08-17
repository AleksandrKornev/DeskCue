import clsx from "clsx";

import { AgentRuntimeIcon } from "@components/AgentRuntimeIcon";
import styles from "@modules/agents/panel/styles.module.scss";
import type { AgentSessionsToolbarProps } from "@modules/agents/types";

export function AgentSessionsToolbar(props: AgentSessionsToolbarProps) {
  const {
    isSearchLoading,
    localRuntimeTabs,
    query,
    selectedLocalRuntime,
    selectedSourceId,
    sourceCards,
    totalAgentSessionsCount,
    onQueryChange,
    onSelectLocalRuntime,
    onSelectSource
  } = props;
  const visibleSourceCards = sourceCards.filter((source) => source.sessionCount > 0);
  const visibleLocalRuntimeTabs = localRuntimeTabs.filter((runtime) => runtime.sessionCount > 0);

  return (
    <div className={styles.toolbar}>
      <div aria-label="Filter chats by agent or runtime" className={styles.sourceStrip} role="group">
        <button
          aria-pressed={selectedSourceId === "all" && selectedLocalRuntime === null}
          className={clsx(
            styles.sourceTab,
            selectedSourceId === "all" && selectedLocalRuntime === null && styles.sourceTabActive
          )}
          onClick={() => onSelectSource("all")}
          type="button"
        >
          All{" "}
          <span>{totalAgentSessionsCount}</span>
        </button>

        {visibleSourceCards.map((source) => (
          <button
            aria-pressed={selectedSourceId === source.agentId}
            key={source.id}
            className={clsx(
              styles.sourceTab,
              selectedSourceId === source.agentId && styles.sourceTabActive
            )}
            onClick={() => onSelectSource(source.agentId)}
            type="button"
          >
            <AgentRuntimeIcon className={styles.sourceTabIcon} runtimeId={source.agentId} />
            {source.label}{" "}
            <span>{source.sessionCountLabel}</span>
          </button>
        ))}

        {visibleLocalRuntimeTabs.map((runtime) => (
          <button
            aria-pressed={selectedLocalRuntime === runtime.id}
            key={runtime.id}
            className={clsx(styles.sourceTab, selectedLocalRuntime === runtime.id && styles.sourceTabActive)}
            onClick={() => onSelectLocalRuntime(runtime.id)}
            type="button"
          >
            <AgentRuntimeIcon className={styles.sourceTabIcon} runtimeId={runtime.id} />
            {runtime.label}{" "}
            <span>{runtime.sessionCount}</span>
          </button>
        ))}
      </div>

      <div className={styles.searchWrap}>
        <input
          className={clsx(styles.field, styles.agentSearch)}
          aria-busy={isSearchLoading}
          autoComplete="off"
          autoCorrect="off"
          name="deskcue-agent-chat-filter"
          placeholder="Find a chat, workspace, or path"
          role="searchbox"
          spellCheck={false}
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {isSearchLoading ? (
          <span
            aria-label="Loading agent chats"
            className={clsx(styles.searchStatus, query && styles.searchStatusWithClear)}
            role="status"
          />
        ) : null}
        {query ? (
          <button
            aria-label="Clear chat search"
            className={styles.searchClear}
            onClick={() => onQueryChange("")}
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
