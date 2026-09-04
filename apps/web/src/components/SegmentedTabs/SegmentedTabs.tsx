import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

import styles from "./styles.module.scss";
import type { SegmentedTabOption, SegmentedTabsProps } from "./types";

const ACTIVE_TAB_SCROLL_MARGIN_PX = 6;

function selectAndFocusTab<TValue extends string>(
  index: number,
  options: SegmentedTabOption<TValue>[],
  tabElements: Array<HTMLButtonElement | null>,
  onSelectTab: (tab: TValue) => void
) {
  const option = options[index];

  if (!option) return;

  onSelectTab(option.key);
  tabElements[index]?.focus();
}

function handleTabKeyDown<TValue extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  options: SegmentedTabOption<TValue>[],
  tabElements: Array<HTMLButtonElement | null>,
  onSelectTab: (tab: TValue) => void
) {
  let nextIndex: number | null = null;

  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (index + 1) % options.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (index - 1 + options.length) % options.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = options.length - 1;
  }

  if (nextIndex === null) return;

  event.preventDefault();
  selectAndFocusTab(nextIndex, options, tabElements, onSelectTab);
}

function scrollActiveTabHorizontally(
  scroller: HTMLElement | null,
  tabElements: Array<HTMLButtonElement | null>
) {
  const activeTabElement = tabElements.find(
    (element) => element?.getAttribute("aria-selected") === "true"
  );

  if (!activeTabElement || !scroller) return;

  const activeTabBounds = activeTabElement.getBoundingClientRect();
  const scrollerBounds = scroller.getBoundingClientRect();

  if (scrollerBounds.width <= 0) return;

  const visibleLeft = scrollerBounds.left + ACTIVE_TAB_SCROLL_MARGIN_PX;
  const visibleRight = scrollerBounds.right - ACTIVE_TAB_SCROLL_MARGIN_PX;
  let scrollDelta = 0;

  if (activeTabBounds.left < visibleLeft) {
    scrollDelta = activeTabBounds.left - visibleLeft;
  } else if (activeTabBounds.right > visibleRight) {
    scrollDelta = activeTabBounds.right - visibleRight;
  }

  if (scrollDelta !== 0) scroller.scrollBy({ left: scrollDelta });
}

export function SegmentedTabs<TValue extends string>({
  activeTab,
  ariaLabel,
  className,
  idPrefix,
  mobileLayout = "scroll",
  options,
  tone = "neutral",
  onSelectTab
}: SegmentedTabsProps<TValue>) {
  const navRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    scrollActiveTabHorizontally(navRef.current, tabRefs.current);
  }, [activeTab]);

  useEffect(() => {
    const controller = new AbortController();

    window.addEventListener("resize", () => scrollActiveTabHorizontally(navRef.current, tabRefs.current), {
      signal: controller.signal
    });

    return () => controller.abort();
  }, []);

  return (
    <div
      className={clsx(
        styles.nav,
        mobileLayout === "fill" && styles.navFillMobile,
        tone === "neutral" && styles.navNeutral,
        className
      )}
      ref={navRef}
    >
      <div className={styles.row} role="tablist" aria-label={ariaLabel}>
        {options.map((tab, index) => (
          <button
            key={tab.key}
            aria-controls={idPrefix ? `${idPrefix}-panel-${tab.key}` : undefined}
            aria-selected={activeTab === tab.key}
            className={clsx(styles.button, activeTab === tab.key ? styles.buttonActive : null)}
            id={idPrefix ? `${idPrefix}-tab-${tab.key}` : undefined}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => onSelectTab(tab.key)}
            onKeyDown={(event) => {
              handleTabKeyDown(event, index, options, tabRefs.current, onSelectTab);
            }}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
