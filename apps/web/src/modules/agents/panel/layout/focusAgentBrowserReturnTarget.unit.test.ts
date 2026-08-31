import { afterEach, describe, expect, it } from "vitest";

import { focusAgentBrowserReturnTarget } from "./focusAgentBrowserReturnTarget";

function createFocusRoot(sessionId: string) {
  const root = document.createElement("section");
  const fallback = document.createElement("h2");
  const card = document.createElement("button");

  fallback.dataset.chatListFocusFallback = "";
  fallback.tabIndex = -1;
  card.dataset.chatListItemId = sessionId;
  root.append(fallback, card);
  document.body.append(root);

  return { card, fallback, root };
}

describe("focusAgentBrowserReturnTarget", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("restores an exact card only within the supplied DeskCue root", () => {
    const first = createFocusRoot("shared-session");
    const second = createFocusRoot("shared-session");

    focusAgentBrowserReturnTarget("shared-session", second.root);

    expect(second.card).toHaveFocus();
    expect(first.card).not.toHaveFocus();
  });

  it("uses the fallback heading within the supplied DeskCue root", () => {
    createFocusRoot("another-session");
    const second = createFocusRoot("second-session");

    focusAgentBrowserReturnTarget("missing-session", second.root);

    expect(second.fallback).toHaveFocus();
  });

  it("prefers a recovery action over an earlier generic fallback", () => {
    const { root } = createFocusRoot("missing-session");
    const retry = document.createElement("button");

    retry.dataset.chatListFocusFallback = "";
    retry.dataset.chatListFocusPriority = "";
    root.append(retry);

    focusAgentBrowserReturnTarget("another-missing-session", root);

    expect(retry).toHaveFocus();
  });
});
