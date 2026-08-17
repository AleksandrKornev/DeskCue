export type ManagedSessionNativeScrollHandlers = {
  onPointerDown: EventListener;
  onPointerEnd: EventListener;
  onPointerMove: EventListener;
  onScroll: EventListener;
  onTouchEnd: EventListener;
  onTouchMove: EventListener;
  onTouchStart: EventListener;
  onWheel: EventListener;
};

export function bindManagedSessionNativeScrollEvents({
  handlers,
  intentTarget,
  scrollTarget
}: {
  handlers: ManagedSessionNativeScrollHandlers;
  intentTarget: EventTarget;
  scrollTarget: EventTarget;
}) {
  scrollTarget.addEventListener("scroll", handlers.onScroll, { passive: true });
  intentTarget.addEventListener("pointerdown", handlers.onPointerDown, { passive: true });
  intentTarget.addEventListener("pointermove", handlers.onPointerMove, { passive: true });
  intentTarget.addEventListener("pointerup", handlers.onPointerEnd, { passive: true });
  intentTarget.addEventListener("pointercancel", handlers.onPointerEnd, { passive: true });
  intentTarget.addEventListener("touchstart", handlers.onTouchStart, { passive: true });
  intentTarget.addEventListener("touchmove", handlers.onTouchMove, { passive: true });
  intentTarget.addEventListener("touchend", handlers.onTouchEnd, { passive: true });
  intentTarget.addEventListener("touchcancel", handlers.onTouchEnd, { passive: true });
  intentTarget.addEventListener("wheel", handlers.onWheel, { passive: true });

  return () => {
    scrollTarget.removeEventListener("scroll", handlers.onScroll);
    intentTarget.removeEventListener("pointerdown", handlers.onPointerDown);
    intentTarget.removeEventListener("pointermove", handlers.onPointerMove);
    intentTarget.removeEventListener("pointerup", handlers.onPointerEnd);
    intentTarget.removeEventListener("pointercancel", handlers.onPointerEnd);
    intentTarget.removeEventListener("touchstart", handlers.onTouchStart);
    intentTarget.removeEventListener("touchmove", handlers.onTouchMove);
    intentTarget.removeEventListener("touchend", handlers.onTouchEnd);
    intentTarget.removeEventListener("touchcancel", handlers.onTouchEnd);
    intentTarget.removeEventListener("wheel", handlers.onWheel);
  };
}
