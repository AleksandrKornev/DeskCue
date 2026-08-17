import type {
  AgentKind,
  AgentSessionSourceCount,
  AgentSessionSummary
} from "@deskcue/protocol";

export interface SourceCard {
  id: string;
  agentId: AgentKind;
  label: string;
  sessionCount: number;
  sessionCountLabel: string;
  statusText: string;
}

function pushSourceCard(cards: SourceCard[], count: number, card: SourceCard) {
  if (count > 0) {
    cards.push(card);
  }
}

function readSourceCount(
  counts: Map<AgentKind, { count: number; exact: boolean }>,
  agentId: AgentKind
) {
  return counts.get(agentId) ?? { count: 0, exact: true };
}

function buildCountMap(
  agentSessions: AgentSessionSummary[],
  sourceCounts: AgentSessionSourceCount[]
) {
  const counts = new Map<AgentKind, { count: number; exact: boolean }>();

  if (sourceCounts.length > 0) {
    for (const sourceCount of sourceCounts) {
      counts.set(sourceCount.agentId, {
        count: sourceCount.count,
        exact: sourceCount.exact
      });
    }
    return counts;
  }

  for (const session of agentSessions) {
    const current = readSourceCount(counts, session.agentId);
    counts.set(session.agentId, {
      count: current.count + 1,
      exact: true
    });
  }

  return counts;
}

function formatSourceCount(count: { count: number; exact: boolean }) {
  return `${count.count}${count.exact ? "" : "+"}`;
}

export function buildSourceCards(
  agentSessions: AgentSessionSummary[],
  sourceCounts: AgentSessionSourceCount[] = []
) {
  const counts = buildCountMap(agentSessions, sourceCounts);

  const cards: SourceCard[] = [];
  const codexCount = readSourceCount(counts, "codex");

  pushSourceCard(cards, codexCount.count, {
    id: "codex",
    agentId: "codex",
    label: "Codex",
    sessionCount: codexCount.count,
    sessionCountLabel: formatSourceCount(codexCount),
    statusText: `${formatSourceCount(codexCount)} resumable threads`
  });

  const claudeCount = readSourceCount(counts, "claude-code");
  pushSourceCard(cards, claudeCount.count, {
    id: "claude-code",
    agentId: "claude-code",
    label: "Claude Code",
    sessionCount: claudeCount.count,
    sessionCountLabel: formatSourceCount(claudeCount),
    statusText: `${formatSourceCount(claudeCount)} resumable threads`
  });

  return cards;
}
