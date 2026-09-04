import { describe, expect, it, vi } from "vitest";

import { bindManagedSessionNativeScrollEvents } from "./nativeScrollEventBinding";

describe("managed session native scroll event binding", () => {
  it("binds contained scroll and global intent without duplicate targets", () => {
    const scrollTarget = new EventTarget();
    const intentTarget = new EventTarget();
    const onScroll = vi.fn();
    const onWheel = vi.fn();
    const noop = vi.fn();
    const unbind = bindManagedSessionNativeScrollEvents({
      handlers: {
        onKeyDown: noop,
        onPointerDown: noop,
        onPointerEnd: noop,
        onPointerMove: noop,
        onScroll,
        onTouchEnd: noop,
        onTouchMove: noop,
        onTouchStart: noop,
        onWheel
      },
      intentTarget,
      scrollTarget
    });

    scrollTarget.dispatchEvent(new Event("scroll"));
    scrollTarget.dispatchEvent(new Event("wheel"));
    intentTarget.dispatchEvent(new Event("wheel"));

    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onWheel).toHaveBeenCalledTimes(1);

    unbind();
    scrollTarget.dispatchEvent(new Event("scroll"));
    intentTarget.dispatchEvent(new Event("wheel"));
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onWheel).toHaveBeenCalledTimes(1);
  });

  it("scopes gesture starts to the chat while tracking active gesture continuation globally", () => {
    const scrollTarget = new EventTarget();
    const intentTarget = new EventTarget();
    const onKeyDown = vi.fn();
    const onPointerDown = vi.fn();
    const onPointerMove = vi.fn();
    const onTouchStart = vi.fn();
    const noop = vi.fn();
    const unbind = bindManagedSessionNativeScrollEvents({
      handlers: {
        onKeyDown,
        onPointerDown,
        onPointerEnd: noop,
        onPointerMove,
        onScroll: noop,
        onTouchEnd: noop,
        onTouchMove: noop,
        onTouchStart,
        onWheel: noop
      },
      intentTarget,
      scrollTarget
    });

    intentTarget.dispatchEvent(new Event("keydown"));
    intentTarget.dispatchEvent(new Event("pointerdown"));
    intentTarget.dispatchEvent(new Event("touchstart"));
    scrollTarget.dispatchEvent(new Event("keydown"));
    scrollTarget.dispatchEvent(new Event("pointerdown"));
    scrollTarget.dispatchEvent(new Event("touchstart"));
    intentTarget.dispatchEvent(new Event("pointermove"));

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
    expect(onTouchStart).toHaveBeenCalledTimes(1);
    expect(onPointerMove).toHaveBeenCalledTimes(1);

    unbind();
  });

  it("ignores history-navigation keys originating from editable page descendants", () => {
    const onKeyDown = vi.fn();
    const noop = vi.fn();
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const editable = document.createElement("div");
    const plaintextEditable = document.createElement("div");
    const uppercaseEditable = document.createElement("div");

    editable.setAttribute("contenteditable", "true");
    plaintextEditable.setAttribute("contenteditable", "plaintext-only");
    uppercaseEditable.setAttribute("contenteditable", "TRUE");
    document.body.append(input, textarea, select, editable, plaintextEditable, uppercaseEditable);
    const unbind = bindManagedSessionNativeScrollEvents({
      handlers: {
        onKeyDown,
        onPointerDown: noop,
        onPointerEnd: noop,
        onPointerMove: noop,
        onScroll: noop,
        onTouchEnd: noop,
        onTouchMove: noop,
        onTouchStart: noop,
        onWheel: noop
      },
      intentTarget: document,
      scrollTarget: window
    });

    for (const target of [
      input,
      textarea,
      select,
      editable,
      plaintextEditable,
      uppercaseEditable
    ]) {
      target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageUp" }));
    }

    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageUp" }));

    expect(onKeyDown).toHaveBeenCalledTimes(1);

    unbind();
    input.remove();
    textarea.remove();
    select.remove();
    editable.remove();
    plaintextEditable.remove();
    uppercaseEditable.remove();
  });
});
