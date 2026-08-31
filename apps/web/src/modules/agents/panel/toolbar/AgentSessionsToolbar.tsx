import clsx from "clsx";
import { useId, useState } from "react";

import type { AgentKind, LocalLlmChatSummary } from "@deskcue/protocol";
import { AgentRuntimeIcon } from "@components/AgentRuntimeIcon";
import type { SourceCard } from "@models/dashboard/sourceCards";
import styles from "@modules/agents/panel/styles.module.scss";
import type { AgentSessionsToolbarProps } from "@modules/agents/types";

type LocalRuntimeTab = AgentSessionsToolbarProps["localRuntimeTabs"][number];

const AGENT_SOURCE_LABELS: Record<AgentKind, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  other: "Other"
};

const AGENT_SOURCE_ORDER: Record<AgentKind, number> = {
  codex: 0,
  "claude-code": 1,
  other: 2
};

const LOCAL_RUNTIME_ORDER: Record<LocalLlmChatSummary["runtimeId"], number> = {
  ollama: 0,
  "lm-studio": 1
};

function getHiddenFiltersLabel(hiddenFiltersCount: number): string {
  return hiddenFiltersCount === 1
    ? "Show 1 more filter"
    : `Show ${hiddenFiltersCount} more filters`;
}

function getVisibleSourceCards(
  sourceCards: SourceCard[],
  selectedSourceId: AgentKind | "all",
  sourceCountsUnavailable: boolean
): SourceCard[] {
  const visibleSourceCards = sourceCards.filter((source) => source.sessionCount > 0);

  if (
    selectedSourceId === "all" ||
    visibleSourceCards.some((source) => source.agentId === selectedSourceId)
  ) {
    return visibleSourceCards;
  }

  const selectedSource = sourceCards.find((source) => source.agentId === selectedSourceId);

  return [
    ...visibleSourceCards,
    selectedSource ?? {
      agentId: selectedSourceId,
      id: selectedSourceId,
      label: AGENT_SOURCE_LABELS[selectedSourceId],
      sessionCount: 0,
      sessionCountLabel: sourceCountsUnavailable ? "—" : "0",
      statusText: sourceCountsUnavailable ? "Session count unavailable" : "No resumable threads"
    }
  ].sort((left, right) => AGENT_SOURCE_ORDER[left.agentId] - AGENT_SOURCE_ORDER[right.agentId]);
}

function getVisibleLocalRuntimeTabs(
  runtimeTabs: LocalRuntimeTab[],
  selectedRuntimeId: LocalLlmChatSummary["runtimeId"] | null
): LocalRuntimeTab[] {
  const visibleRuntimeTabs = runtimeTabs.filter((runtime) => runtime.sessionCount > 0);

  if (
    !selectedRuntimeId ||
    visibleRuntimeTabs.some((runtime) => runtime.id === selectedRuntimeId)
  ) {
    return visibleRuntimeTabs;
  }

  const selectedRuntime = runtimeTabs.find((runtime) => runtime.id === selectedRuntimeId);

  return [
    ...visibleRuntimeTabs,
    selectedRuntime ?? {
      id: selectedRuntimeId,
      label: selectedRuntimeId === "lm-studio" ? "LM Studio" : "Ollama",
      sessionCount: 0
    }
  ].sort((left, right) => LOCAL_RUNTIME_ORDER[left.id] - LOCAL_RUNTIME_ORDER[right.id]);
}

export function AgentSessionsToolbar(props: AgentSessionsToolbarProps) {
  const {
    isSearchLoading,
    localRuntimeTabs,
    query,
    selectedLocalRuntime,
    selectedSourceId,
    sourceCountsUnavailable = false,
    sourceCards,
    totalAgentSessionsCount,
    onQueryChange,
    onSelectLocalRuntime,
    onSelectSource
  } = props;
  const searchInputId = useId();
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const visibleSourceCards = getVisibleSourceCards(
    sourceCards,
    selectedSourceId,
    sourceCountsUnavailable
  );
  const visibleLocalRuntimeTabs = getVisibleLocalRuntimeTabs(
    localRuntimeTabs,
    selectedLocalRuntime
  );
  const hiddenMobileFiltersCount = visibleSourceCards.filter(
    (source) => source.agentId !== selectedSourceId
  ).length + visibleLocalRuntimeTabs.filter(
    (runtime) => runtime.id !== selectedLocalRuntime
  ).length;

  return (
    <div className={styles.toolbar}>
      <div
        aria-label="Filter chats by agent or runtime"
        className={clsx(styles.sourceStrip, filtersExpanded && styles.sourceStripExpanded)}
        role="group"
      >
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

        {visibleSourceCards.map((source) => {
          const isCountUnavailable = source.statusText === "Session count unavailable";

          return (
            <button
              aria-pressed={selectedSourceId === source.agentId}
              key={source.id}
              className={clsx(
                styles.sourceTab,
                selectedSourceId === source.agentId && styles.sourceTabActive,
                selectedSourceId !== source.agentId && styles.sourceTabMobileOptional
              )}
              onClick={() => onSelectSource(source.agentId)}
              type="button"
            >
              <AgentRuntimeIcon className={styles.sourceTabIcon} runtimeId={source.agentId} />
              {source.label}{" "}
              <span aria-hidden={isCountUnavailable || undefined}>{source.sessionCountLabel}</span>
              {isCountUnavailable ? (
                <span className={styles.srOnly}>Session count unavailable</span>
              ) : null}
            </button>
          );
        })}

        {visibleLocalRuntimeTabs.map((runtime) => (
          <button
            aria-pressed={selectedLocalRuntime === runtime.id}
            key={runtime.id}
            className={clsx(
              styles.sourceTab,
              selectedLocalRuntime === runtime.id && styles.sourceTabActive,
              selectedLocalRuntime !== runtime.id && styles.sourceTabMobileOptional
            )}
            onClick={() => onSelectLocalRuntime(runtime.id)}
            type="button"
          >
            <AgentRuntimeIcon className={styles.sourceTabIcon} runtimeId={runtime.id} />
            {runtime.label}{" "}
            <span>{runtime.sessionCount}</span>
          </button>
        ))}

        {hiddenMobileFiltersCount > 0 ? (
          <button
            aria-expanded={filtersExpanded}
            className={clsx(styles.sourceTab, styles.sourceFilterDisclosure)}
            onClick={() => setFiltersExpanded((expanded) => !expanded)}
            type="button"
          >
            {filtersExpanded ? "Hide extra filters" : getHiddenFiltersLabel(hiddenMobileFiltersCount)}
          </button>
        ) : null}
      </div>

      <div className={styles.searchWrap}>
        <label className={styles.srOnly} htmlFor={searchInputId}>Search chats</label>
        <input
          className={clsx(styles.field, styles.agentSearch)}
          aria-busy={isSearchLoading}
          autoComplete="off"
          autoCorrect="off"
          id={searchInputId}
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
