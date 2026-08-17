import { describe, expect, it, vi } from "vitest";

import type { AgentSessionDetail } from "@deskcue/protocol";

import { createDashboardAgentSessionActionController } from "./agentSessionActions";

function agentSessionDetail(
  id: string,
  transcript: unknown[],
  transcriptView: unknown
) {
  return {
    id,
    transcript,
    transcriptView
  } as AgentSessionDetail;
}

describe("dashboard agent session action controller", () => {
  it("refreshes lightweight metadata without discarding the cached transcript", async () => {
    const cached = agentSessionDetail("session-1", ["cached"], "cached-view");
    const fresh = agentSessionDetail("session-1", [], "fresh-view");
    const mergeActiveTakenOverAgentSessionDetail = vi.fn();
    const getOne = vi.fn(() => Promise.resolve(fresh));
    const controller = createDashboardAgentSessionActionController({
      api: {
        getOne,
        markReviewed: vi.fn()
      },
      clearReadyForReview: vi.fn(),
      formatError: String,
      setErrorIfEmpty: vi.fn(),
      store: {
        activeTakenOverAgentSession: cached,
        markAgentSessionReviewedAt: vi.fn(),
        mergeActiveTakenOverAgentSessionDetail
      }
    });

    await controller.refreshActiveTakenOverAgentSession("session-1");

    expect(getOne).toHaveBeenCalledWith("session-1", {
      omitTranscript: true
    });
    expect(mergeActiveTakenOverAgentSessionDetail).toHaveBeenCalledWith({
      ...fresh,
      transcript: cached.transcript,
      transcriptView: cached.transcriptView
    });
  });

  it("keeps metadata refresh failures silent for the normal live retry path", async () => {
    const mergeActiveTakenOverAgentSessionDetail = vi.fn();
    const getOne = vi.fn(() => Promise.reject(new Error("offline")));
    const controller = createDashboardAgentSessionActionController({
      api: {
        getOne,
        markReviewed: vi.fn()
      },
      clearReadyForReview: vi.fn(),
      formatError: String,
      setErrorIfEmpty: vi.fn(),
      store: {
        activeTakenOverAgentSession: null,
        markAgentSessionReviewedAt: vi.fn(),
        mergeActiveTakenOverAgentSessionDetail
      }
    });

    await expect(
      controller.refreshActiveTakenOverAgentSession("session-1")
    ).resolves.toBeUndefined();
    expect(mergeActiveTakenOverAgentSessionDetail).not.toHaveBeenCalled();
  });

  it("optimistically clears review state and reconciles the server timestamp", async () => {
    const clearReadyForReview = vi.fn();
    const markAgentSessionReviewedAt = vi.fn();
    const controller = createDashboardAgentSessionActionController({
      api: {
        getOne: vi.fn(),
        markReviewed: vi.fn(() => Promise.resolve({
          agentSessionId: "session-1",
          reviewedAt: "2026-08-06T00:00:00.000Z"
        }))
      },
      clearReadyForReview,
      formatError: String,
      setErrorIfEmpty: vi.fn(),
      store: {
        activeTakenOverAgentSession: null,
        markAgentSessionReviewedAt,
        mergeActiveTakenOverAgentSessionDetail: vi.fn()
      }
    });

    controller.markAgentSessionReviewed("session-1");
    expect(clearReadyForReview).toHaveBeenCalledWith("session-1");
    await Promise.resolve();

    expect(markAgentSessionReviewedAt).toHaveBeenCalledWith(
      "session-1",
      "2026-08-06T00:00:00.000Z"
    );
  });

  it("reports a review request failure without restoring stale local state", async () => {
    const clearReadyForReview = vi.fn();
    const setErrorIfEmpty = vi.fn();
    const controller = createDashboardAgentSessionActionController({
      api: {
        getOne: vi.fn(),
        markReviewed: vi.fn(() => Promise.reject(new Error("review failed")))
      },
      clearReadyForReview,
      formatError: (error) => (error as Error).message,
      setErrorIfEmpty,
      store: {
        activeTakenOverAgentSession: null,
        markAgentSessionReviewedAt: vi.fn(),
        mergeActiveTakenOverAgentSessionDetail: vi.fn()
      }
    });

    controller.markAgentSessionReviewed("session-1");
    await Promise.resolve();
    await Promise.resolve();

    expect(clearReadyForReview).toHaveBeenCalledWith("session-1");
    expect(setErrorIfEmpty).toHaveBeenCalledWith("review failed");
  });
});
