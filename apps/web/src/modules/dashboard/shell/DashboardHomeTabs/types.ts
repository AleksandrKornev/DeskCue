import type { ReactNode } from "react";

export type DashboardHomeTab = "chats" | "tools";

export type DashboardHomeTabsProps = {
  chatsContent: ReactNode;
  toolsContent?: ReactNode;
};
