import clsx from "clsx";
import { useRef } from "react";
import type { KeyboardEvent } from "react";

import styles from "./styles.module.scss";
import type { SegmentedTabsProps } from "./types";

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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectAndFocusTab = (index: number) => {
    const option = options[index];
    if (!option) {
      return;
    }

    onSelectTab(option.key);
    tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
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

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    selectAndFocusTab(nextIndex);
  };

  return (
    <div
      className={clsx(
        styles.nav,
        mobileLayout === "fill" && styles.navFillMobile,
        tone === "neutral" && styles.navNeutral,
        className
      )}
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
            onKeyDown={(event) => handleKeyDown(event, index)}
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
