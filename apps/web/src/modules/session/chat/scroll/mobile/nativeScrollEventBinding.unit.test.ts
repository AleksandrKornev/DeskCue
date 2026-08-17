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
});
