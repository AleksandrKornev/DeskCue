export type ManagedSessionNativeScrollHandlers = {
  onKeyDown: EventListener;
  onPointerDown: EventListener;
  onPointerEnd: EventListener;
  onPointerMove: EventListener;
  onScroll: EventListener;
  onTouchEnd: EventListener;
  onTouchMove: EventListener;
  onTouchStart: EventListener;
  onWheel: EventListener;
};

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!target || typeof target !== "object" || !("closest" in target)) return false;

  const closest = (target as { closest?: unknown }).closest;

  if (typeof closest !== "function") return false;

  const editable = closest.call(
    target,
    "input, textarea, select, [contenteditable]"
  ) as Element | null;

  if (!editable) return false;
  if (!editable.hasAttribute("contenteditable")) return true;

  return editable.getAttribute("contenteditable")?.toLowerCase() !== "false";
}

class ManagedSessionNativeKeyDownListener implements EventListenerObject {
  constructor(private readonly onKeyDown: EventListener) {}

  handleEvent(event: Event) {
    if (isEditableKeyboardTarget(event.target)) return;

    this.onKeyDown(event);
  }
}

export function bindManagedSessionNativeScrollEvents({
  handlers,
  intentTarget,
  scrollTarget
}: {
  handlers: ManagedSessionNativeScrollHandlers;
  intentTarget: EventTarget;
  scrollTarget: EventTarget;
}) {
  const onKeyDown = new ManagedSessionNativeKeyDownListener(handlers.onKeyDown);

  scrollTarget.addEventListener("scroll", handlers.onScroll, { passive: true });
  scrollTarget.addEventListener("keydown", onKeyDown);
  scrollTarget.addEventListener("pointerdown", handlers.onPointerDown, { passive: true });
  scrollTarget.addEventListener("touchstart", handlers.onTouchStart, { passive: true });
  scrollTarget.addEventListener("wheel", handlers.onWheel, { passive: true });
  intentTarget.addEventListener("pointermove", handlers.onPointerMove, { passive: true });
  intentTarget.addEventListener("pointerup", handlers.onPointerEnd, { passive: true });
  intentTarget.addEventListener("pointercancel", handlers.onPointerEnd, { passive: true });
  intentTarget.addEventListener("touchmove", handlers.onTouchMove, { passive: true });
  intentTarget.addEventListener("touchend", handlers.onTouchEnd, { passive: true });
  intentTarget.addEventListener("touchcancel", handlers.onTouchEnd, { passive: true });

  return () => {
    scrollTarget.removeEventListener("scroll", handlers.onScroll);
    scrollTarget.removeEventListener("keydown", onKeyDown);
    scrollTarget.removeEventListener("pointerdown", handlers.onPointerDown);
    scrollTarget.removeEventListener("touchstart", handlers.onTouchStart);
    scrollTarget.removeEventListener("wheel", handlers.onWheel);
    intentTarget.removeEventListener("pointermove", handlers.onPointerMove);
    intentTarget.removeEventListener("pointerup", handlers.onPointerEnd);
    intentTarget.removeEventListener("pointercancel", handlers.onPointerEnd);
    intentTarget.removeEventListener("touchmove", handlers.onTouchMove);
    intentTarget.removeEventListener("touchend", handlers.onTouchEnd);
    intentTarget.removeEventListener("touchcancel", handlers.onTouchEnd);
  };
}
