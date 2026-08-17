import { startTransition } from "react";

import type { SessionLogLine } from "@deskcue/protocol";
import type { DashboardStore } from "@modules/dashboard/model/store";

export function createSelectedSessionLogQueue({
  store
}: {
  store: DashboardStore;
}) {
  let flushTimer: number | null = null;
  const queue: Array<{ log: SessionLogLine; sessionId: string }> = [];

  const flush = () => {
    flushTimer = null;
    if (queue.length === 0) {
      return;
    }

    const queuedLogs = queue.splice(0);
    const logsBySessionId = new Map<string, SessionLogLine[]>();
    for (const { log, sessionId } of queuedLogs) {
      const logs = logsBySessionId.get(sessionId);
      if (logs) {
        logs.push(log);
      } else {
        logsBySessionId.set(sessionId, [log]);
      }
    }
    startTransition(() => {
      for (const [sessionId, logs] of logsBySessionId) {
        store.appendSelectedSessionLogs(sessionId, logs);
      }
    });
  };

  return {
    flush,
    push(sessionId: string, log: SessionLogLine) {
      queue.push({ log, sessionId });
      if (flushTimer !== null) {
        return;
      }

      flushTimer = window.setTimeout(flush, 120);
    },
    teardown() {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flush();
      }
    }
  };
}

export type SelectedSessionLogQueue = ReturnType<typeof createSelectedSessionLogQueue>;
