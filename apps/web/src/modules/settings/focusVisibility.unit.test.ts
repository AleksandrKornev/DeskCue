import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  observeSettingsActionBarFocusVisibility,
  scheduleSettingsFocusVisibility
} from "./focusVisibility";

const actionBarSelector = "[data-settings-action-bar]";
const stickyNavigationSelector = ".settings-tabs";

function createFocusFixture() {
  const page = document.createElement("main");
  const stickyNavigation = document.createElement("div");
  const target = document.createElement("input");
  const actionBar = document.createElement("div");

  stickyNavigation.className = "settings-tabs";
  actionBar.dataset.settingsActionBar = "";
  Object.defineProperty(actionBar, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ bottom: 568, top: 499 })
  });
  Object.defineProperty(stickyNavigation, "getBoundingClientRect", {
    value: () => ({ bottom: 70, top: 0 })
  });
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ bottom: 580, top: 535 })
  });

  page.append(stickyNavigation, target, actionBar);
  document.body.append(page);
  target.focus();

  return { actionBar, page, target };
}

describe("scheduleSettingsFocusVisibility", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  });

  it("moves a focused field above the fixed action bar at any viewport size", () => {
    const { actionBar, page, target } = createFocusFixture();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);

    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => ({
      position: element === actionBar ? "fixed" : "static"
    }) as CSSStyleDeclaration);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);

      return 1;
    });

    scheduleSettingsFocusVisibility({
      actionBarSelector,
      page,
      stickyNavigationSelector,
      target
    });

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "auto", top: 93 });
  });

  it("moves a focused field below sticky tabs when there is no action bar", () => {
    const { actionBar, page, target } = createFocusFixture();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);

    actionBar.remove();
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => ({ bottom: 65, top: 20 })
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);

      return 1;
    });

    scheduleSettingsFocusVisibility({
      actionBarSelector,
      page,
      stickyNavigationSelector,
      target
    });

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "auto", top: -62 });
  });

  it("ignores a stale callback after its target leaves the page", () => {
    const { page, target } = createFocusFixture();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    let scheduledCallback: FrameRequestCallback | undefined;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduledCallback = callback;

      return 1;
    });

    scheduleSettingsFocusVisibility({
      actionBarSelector,
      page,
      stickyNavigationSelector,
      target
    });

    target.remove();
    scheduledCallback?.(0);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("ignores focus owned by a portal outside the settings page", () => {
    const { page } = createFocusFixture();
    const portalTarget = document.createElement("button");
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);

    document.body.append(portalTarget);
    portalTarget.focus();

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);

      return 1;
    });

    scheduleSettingsFocusVisibility({
      actionBarSelector,
      page,
      stickyNavigationSelector,
      target: portalTarget
    });

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("rechecks an already-focused field when a fixed action bar mounts", async () => {
    const { actionBar, page, target } = createFocusFixture();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);

    actionBar.remove();
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => ({
      position: element === actionBar ? "fixed" : "static"
    }) as CSSStyleDeclaration);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);

      return 1;
    });
    const disconnect = observeSettingsActionBarFocusVisibility({
      actionBarSelector,
      page,
      stickyNavigationSelector
    });

    page.append(actionBar);

    await vi.waitFor(() => {
      expect(scrollBy).toHaveBeenCalledWith({ behavior: "auto", top: 93 });
    });

    expect(target).toHaveFocus();
    disconnect();
  });

  it("rechecks an already-focused field when a compact action bar grows", async () => {
    const { actionBar, page, target } = createFocusFixture();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    let actionBarTop = 600;

    Object.defineProperty(actionBar, "getBoundingClientRect", {
      value: () => ({ bottom: 650, top: actionBarTop })
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => ({
      position: element === actionBar ? "fixed" : "static"
    }) as CSSStyleDeclaration);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);

      return 1;
    });
    const disconnect = observeSettingsActionBarFocusVisibility({
      actionBarSelector,
      page,
      stickyNavigationSelector
    });

    actionBarTop = 499;
    actionBar.dataset.settingsActionBar = "full";

    await vi.waitFor(() => {
      expect(scrollBy).toHaveBeenCalledWith({ behavior: "auto", top: 93 });
    });

    expect(target).toHaveFocus();
    disconnect();
  });
});
