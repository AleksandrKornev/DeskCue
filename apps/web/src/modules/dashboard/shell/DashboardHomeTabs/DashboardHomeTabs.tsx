import { useState } from "react";

import { SegmentedTabs } from "@components/SegmentedTabs";

import { dashboardHomeTabs } from "./helpers";
import styles from "./styles.module.scss";
import type { DashboardHomeTab, DashboardHomeTabsProps } from "./types";

export function DashboardHomeTabs({
  chatsContent,
  toolsContent
}: DashboardHomeTabsProps) {
  const [activeTab, setActiveTab] = useState<DashboardHomeTab>("chats");
  const hasTools = toolsContent !== null && toolsContent !== undefined;
  const visibleActiveTab = hasTools ? activeTab : "chats";

  return (
    <div className={styles.shell}>
      {hasTools ? (
        <div className={styles.header}>
          <SegmentedTabs
            activeTab={visibleActiveTab}
            ariaLabel="Dashboard sections"
            mobileLayout="fill"
            options={dashboardHomeTabs}
            tone="neutral"
            onSelectTab={setActiveTab}
          />
        </div>
      ) : null}

      <div
        className={styles.panel}
        role="tabpanel"
        aria-label={visibleActiveTab === "chats" ? "Chats" : "Tools"}
      >
        {visibleActiveTab === "chats" ? (
          chatsContent
        ) : (
          <div className={styles.toolsPanel}>
            <div className={styles.toolsStack}>
              {toolsContent}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
