import { act, render } from "@testing-library/react";
import type { MutableRefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AgentTranscriptChangesResponse } from "@deskcue/protocol";
import type {
  ConversationActivity,
  ManagedSessionActivityHydrationRepository
} from "@modules/session/types";

import { useManagedSessionActivityEntryHydration } from "./useManagedSessionActivityEntryHydration";

function createCompactActivity(entryId: string): ConversationActivity {
  return {
    entries: [{
      id: `${entryId}:compact`,
      isCompact: true,
      phase: null,
      role: "tool",
      sourceEntryIds: [entryId],
      text: "compact",
      timestamp: "2026-08-05T10:00:00.000Z"
    }],
    id: "details-1",
    kind: "details",
    label: "Details (1)",
    sourceEntryIds: [entryId],
    timestamp: "2026-08-05T10:00:00.000Z"
  };
}

function TestHarness({
  activityHydrationRepository,
  agentSessionId,
  controllerRef,
  hydrateChanges,
  hydrateEntries
}: {
  activityHydrationRepository?: ManagedSessionActivityHydrationRepository;
  agentSessionId: string;
  controllerRef: MutableRefObject<Controller | null>;
  hydrateChanges: () => Promise<AgentTranscriptChangesResponse>;
  hydrateEntries: (
    sessionId: string,
    entryIds: string[]
  ) => Promise<ConversationActivity["entries"]>;
}) {
  controllerRef.current = useManagedSessionActivityEntryHydration({
    activityHydrationRepository,
    agentSessionId,
    onHydrateAgentSessionChanges: hydrateChanges,
    onHydrateAgentSessionTranscriptEntries: hydrateEntries
  });
  return null;
}

describe("useManagedSessionActivityEntryHydration", () => {
  it("deduplicates concurrent hydration for the same transcript entries", async () => {
    const controllerRef = { current: null } as MutableRefObject<Controller | null>;
    let resolveHydration: ((entries: ConversationActivity["entries"]) => void) | null = null;
    const hydrateEntries = vi.fn(() => new Promise<ConversationActivity["entries"]>((resolve) => {
      resolveHydration = resolve;
    }));
    const activity = createCompactActivity("detail-duplicate");

    render(
      <TestHarness
        agentSessionId="agent-1"
        controllerRef={controllerRef}
        hydrateChanges={() => Promise.resolve({
          files: [],
          groupId: "changes-1",
          sessionId: "agent-1"
        })}
        hydrateEntries={hydrateEntries}
      />
    );

    const firstHydration = controllerRef.current!.hydrateActivityEntries(activity);
    const duplicateHydration = controllerRef.current!.hydrateActivityEntries(activity);
    expect(hydrateEntries).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveHydration?.([{
        id: "detail-duplicate",
        phase: null,
        role: "tool",
        text: "hydrated once",
        timestamp: "2026-08-05T10:00:00.000Z"
      }]);
      await Promise.all([firstHydration, duplicateHydration]);
    });

    expect(controllerRef.current?.readHydratedActivityEntries(activity)[0]?.text)
      .toBe("hydrated once");
  });

  it("hydrates through supplied callbacks and clears local fallback data on session change", async () => {
    const controllerRef = { current: null } as MutableRefObject<Controller | null>;
    const hydrateEntries = vi.fn((_sessionId: string, entryIds: string[]) => Promise.resolve(
      entryIds.map((id) => ({
        id,
        phase: null,
        role: "tool" as const,
        text: `hydrated:${id}`,
        timestamp: "2026-08-05T10:00:00.000Z"
      }))
    ));
    const hydrateChanges = vi.fn(() => Promise.resolve({
      files: [],
      groupId: "changes-1",
      sessionId: "agent-1"
    } satisfies AgentTranscriptChangesResponse));
    const activity = createCompactActivity("detail-1");
    const view = render(
      <TestHarness
        agentSessionId="agent-1"
        controllerRef={controllerRef}
        hydrateChanges={hydrateChanges}
        hydrateEntries={hydrateEntries}
      />
    );

    await act(async () => {
      await controllerRef.current?.hydrateActivityEntries(activity);
    });

    expect(hydrateEntries).toHaveBeenCalledWith("agent-1", ["detail-1"]);
    expect(controllerRef.current?.readHydratedActivityEntries(activity)[0]?.text)
      .toBe("hydrated:detail-1");

    view.rerender(
      <TestHarness
        agentSessionId="agent-2"
        controllerRef={controllerRef}
        hydrateChanges={hydrateChanges}
        hydrateEntries={hydrateEntries}
      />
    );

    expect(controllerRef.current?.readHydratedActivityEntries(activity)[0]?.text)
      .toBe("compact");
  });

  it("uses an explicit repository as the hydration freshness owner", async () => {
    const controllerRef = { current: null } as MutableRefObject<Controller | null>;
    const entriesById = new Map<string, ConversationActivity["entries"][number]>();
    const repository: ManagedSessionActivityHydrationRepository = {
      hasFailedChanges: () => false,
      hasFailedTranscriptEntry: () => false,
      hasFailedTranscriptEntries: () => false,
      readHydratedChanges: () => null,
      readHydratedTranscriptEntries: (_sessionId, entryIds) => entryIds.flatMap((entryId) => {
        const entry = entriesById.get(entryId);
        return entry ? [entry] : [];
      }),
      readHydratedTranscriptEntry: (_sessionId, entryId) => entriesById.get(entryId) ?? null
    };
    const hydrateEntries = vi.fn((_sessionId: string, entryIds: string[]) => {
      const entries = entryIds.map((id) => ({
        id,
        phase: null,
        role: "tool" as const,
        text: `repository:${id}`,
        timestamp: "2026-08-05T10:00:00.000Z"
      }));
      for (const entry of entries) {
        entriesById.set(entry.id, entry);
      }
      return Promise.resolve(entries);
    });
    const activity = createCompactActivity("detail-2");

    render(
      <TestHarness
        activityHydrationRepository={repository}
        agentSessionId="agent-1"
        controllerRef={controllerRef}
        hydrateChanges={() => Promise.resolve({
          files: [],
          groupId: "changes-1",
          sessionId: "agent-1"
        })}
        hydrateEntries={hydrateEntries}
      />
    );

    await act(async () => {
      await controllerRef.current?.hydrateActivityEntries(activity);
    });

    expect(controllerRef.current?.readHydratedActivityEntries(activity)[0]?.text)
      .toBe("repository:detail-2");
  });
});

type Controller = ReturnType<typeof useManagedSessionActivityEntryHydration>;
