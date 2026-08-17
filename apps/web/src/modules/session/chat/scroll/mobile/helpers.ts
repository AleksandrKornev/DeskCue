import type { ManagedSessionNativeScrollScheduler } from "./managedSessionNativeScrollController";

export const browserNativeScrollScheduler: ManagedSessionNativeScrollScheduler = {
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  clearTimeout: (handle) => window.clearTimeout(handle),
  now: () => performance.now(),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs)
};

export function readElementPageTop(
  element: HTMLElement,
  scrollingElement: Element
) {
  return element.getBoundingClientRect().top + scrollingElement.scrollTop;
}
