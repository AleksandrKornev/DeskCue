const SETTINGS_FOCUS_GAP_PX = 12;

type ScheduleSettingsFocusVisibilityOptions = {
  actionBarSelector: string;
  page: HTMLElement;
  stickyNavigationSelector: string;
  target: HTMLElement;
};

type ObserveSettingsActionBarFocusVisibilityOptions = Omit<
  ScheduleSettingsFocusVisibilityOptions,
  "target"
>;

function nodeContainsSettingsActionBar(node: Node, selector: string) {
  return node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null);
}

function mutationAddsOrChangesSettingsActionBar(mutation: MutationRecord, selector: string) {
  if (mutation.type === "attributes") return (mutation.target as Element).matches(selector);

  return Array.from(mutation.addedNodes).some((node) => nodeContainsSettingsActionBar(node, selector));
}

function findFixedSettingsActionBar(page: HTMLElement, selector: string) {
  return Array.from(page.querySelectorAll<HTMLElement>(selector))
    .find((element) => getComputedStyle(element).position === "fixed") ?? null;
}

function adjustSettingsFocusVisibility({
  actionBarSelector,
  page,
  stickyNavigationSelector,
  target
}: ScheduleSettingsFocusVisibilityOptions) {
  const stickyNavigation = page.querySelector<HTMLElement>(stickyNavigationSelector);
  const fixedActionBar = findFixedSettingsActionBar(page, actionBarSelector);
  const focusIsInsideNavigation = Boolean(target.closest(stickyNavigationSelector));
  const focusIsInsideActionBar = fixedActionBar !== null && target.closest(actionBarSelector) === fixedActionBar;

  if (focusIsInsideNavigation || focusIsInsideActionBar) return;

  const targetRect = target.getBoundingClientRect();
  const safeTop = (stickyNavigation?.getBoundingClientRect().bottom ?? 0) + SETTINGS_FOCUS_GAP_PX;
  const safeBottom = (fixedActionBar?.getBoundingClientRect().top ?? window.innerHeight) - SETTINGS_FOCUS_GAP_PX;

  if (targetRect.top < safeTop) {
    window.scrollBy({ top: targetRect.top - safeTop, behavior: "auto" });
  } else if (targetRect.bottom > safeBottom) {
    window.scrollBy({ top: targetRect.bottom - safeBottom, behavior: "auto" });
  }
}

export function scheduleSettingsFocusVisibility(options: ScheduleSettingsFocusVisibilityOptions) {
  window.requestAnimationFrame(() => {
    const { page, target } = options;
    const focusStillBelongsToPage = page.isConnected && target.isConnected && page.contains(target);

    if (!focusStillBelongsToPage || document.activeElement !== target) return;

    adjustSettingsFocusVisibility(options);
  });
}

export function observeSettingsActionBarFocusVisibility({
  actionBarSelector,
  page,
  stickyNavigationSelector
}: ObserveSettingsActionBarFocusVisibilityOptions) {
  const observer = new MutationObserver((mutations) => {
    const actionBarChanged = mutations.some((mutation) =>
      mutationAddsOrChangesSettingsActionBar(mutation, actionBarSelector)
    );

    if (!actionBarChanged) return;

    const target = document.activeElement;

    if (!(target instanceof HTMLElement) || !page.contains(target)) return;

    scheduleSettingsFocusVisibility({
      actionBarSelector,
      page,
      stickyNavigationSelector,
      target
    });
  });

  observer.observe(page, {
    attributeFilter: ["data-settings-action-bar"],
    attributes: true,
    childList: true,
    subtree: true
  });

  return () => observer.disconnect();
}
