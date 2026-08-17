type SourceSession = {
  source?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

export function isSubagentChat(session: SourceSession | null | undefined) {
  const source = session?.source;
  if (!isRecord(source)) {
    return false;
  }

  const subagent = source.subagent;
  return isRecord(subagent) && isRecord(subagent.thread_spawn);
}
