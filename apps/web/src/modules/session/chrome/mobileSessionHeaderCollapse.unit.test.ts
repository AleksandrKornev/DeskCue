import { describe, expect, it } from "vitest";

import {
  findActiveSessionScrollTarget,
  findVerticalScrollTarget,
  MOBILE_HEADER_COLLAPSE_MEDIA_QUERY,
  preserveMobileScrollAnchor,
  readCollapsibleSessionMetaHeight
} from "./mobileSessionHeaderCollapse";

function setScrollableMetrics(element: HTMLElement) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 300 }
  });
  element.style.overflowY = "auto";
}

describe("mobile header responsive contract", () => {
  it("matches the mobile and compact-height CSS breakpoints", () => {
    expect(MOBILE_HEADER_COLLAPSE_MEDIA_QUERY)
      .toBe("(max-width: 720px), (max-height: 640px)");
  });
});

describe("preserveMobileScrollAnchor", () => {
  it("offsets the active scroll target by the toolbar height delta", () => {
    const scrollTarget = document.createElement("div");

    scrollTarget.scrollTop = 240;
    preserveMobileScrollAnchor(scrollTarget, -45);

    expect(scrollTarget.scrollTop).toBe(195);

    preserveMobileScrollAnchor(scrollTarget, 45);

    expect(scrollTarget.scrollTop).toBe(240);
  });

  it("clamps the scroll position at the start of the surface", () => {
    const scrollTarget = document.createElement("div");

    scrollTarget.scrollTop = 20;
    preserveMobileScrollAnchor(scrollTarget, -45);

    expect(scrollTarget.scrollTop).toBe(0);
  });

  it("reads the real removable metadata height for the collapse threshold", () => {
    const toolbar = document.createElement("div");
    const meta = document.createElement("div");

    meta.dataset.collapsibleSessionMeta = "";
    meta.getBoundingClientRect = () => ({ height: 127.2 }) as DOMRect;
    toolbar.append(meta);

    expect(readCollapsibleSessionMetaHeight(toolbar)).toBe(128);
  });
});

describe("mobile session scroll target resolution", () => {
  it("resolves a vertical scroll owner when a gesture starts on an SVG child", () => {
    const sessionSurface = document.createElement("div");
    const scrollTarget = document.createElement("div");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");

    setScrollableMetrics(scrollTarget);
    scrollTarget.append(icon);
    sessionSurface.append(scrollTarget);

    expect(findVerticalScrollTarget(icon, sessionSurface)).toBe(scrollTarget);
  });

  it("rebinds breakpoint compensation to the visible tab instead of a hidden target", () => {
    const sessionSurface = document.createElement("div");
    const toolbar = document.createElement("div");
    const hiddenPanel = document.createElement("div");
    const hiddenTarget = document.createElement("div");
    const activePanel = document.createElement("div");
    const activeTarget = document.createElement("div");

    hiddenPanel.hidden = true;
    hiddenPanel.setAttribute("role", "tabpanel");
    activePanel.setAttribute("role", "tabpanel");
    setScrollableMetrics(hiddenTarget);
    setScrollableMetrics(activeTarget);
    hiddenPanel.append(hiddenTarget);
    activePanel.append(activeTarget);
    sessionSurface.append(toolbar, hiddenPanel, activePanel);

    expect(findActiveSessionScrollTarget(toolbar, hiddenTarget)).toBe(activeTarget);
  });

  it("rebinds when the previous nested target is no longer scrollable", () => {
    const sessionSurface = document.createElement("div");
    const toolbar = document.createElement("div");
    const activePanel = document.createElement("div");
    const staleTarget = document.createElement("div");
    const activeTarget = document.createElement("div");

    activePanel.setAttribute("role", "tabpanel");
    setScrollableMetrics(activeTarget);
    activePanel.append(staleTarget, activeTarget);
    sessionSurface.append(toolbar, activePanel);

    expect(findActiveSessionScrollTarget(toolbar, staleTarget)).toBe(activeTarget);
  });
});
