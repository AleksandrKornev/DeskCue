import type { MutableRefObject } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  queueLocalLlmPreviewMutation
} from "./localLlmPreviewMutationQueue";
import type {
  LocalLlmPreviewMutationQueue
} from "./localLlmPreviewMutationQueue";

function createQueueRef(): MutableRefObject<LocalLlmPreviewMutationQueue> {
  return { current: { active: null, pending: null } };
}

describe("local LLM preview mutation queue", () => {
  it("serializes the active mutation and keeps only the latest pending intent", async () => {
    let releaseActive!: () => void;
    const queueRef = createQueueRef();
    const activeRun = vi.fn(() => new Promise<boolean>((resolve) => {
      releaseActive = () => resolve(true);
    }));
    const supersededRun = vi.fn(() => Promise.resolve(true));
    const latestRun = vi.fn(() => Promise.resolve(true));

    const active = queueLocalLlmPreviewMutation(queueRef, () => true, activeRun);
    const superseded = queueLocalLlmPreviewMutation(queueRef, () => true, supersededRun);
    const latest = queueLocalLlmPreviewMutation(queueRef, () => true, latestRun);

    expect(await superseded).toBe(false);
    expect(supersededRun).not.toHaveBeenCalled();

    releaseActive();

    await expect(active).resolves.toBe(true);
    await expect(latest).resolves.toBe(true);
    expect(latestRun).toHaveBeenCalledTimes(1);
  });

  it("drops an invalidated pending intent before it reaches the server", async () => {
    let releaseActive!: () => void;
    let current = true;
    const queueRef = createQueueRef();
    const active = queueLocalLlmPreviewMutation(queueRef, () => true, () =>
      new Promise<boolean>((resolve) => {
        releaseActive = () => resolve(true);
      })
    );
    const pendingRun = vi.fn(() => Promise.resolve(true));
    const pending = queueLocalLlmPreviewMutation(queueRef, () => current, pendingRun);

    current = false;
    releaseActive();

    await expect(active).resolves.toBe(true);
    await expect(pending).resolves.toBe(false);
    expect(pendingRun).not.toHaveBeenCalled();
  });
});
