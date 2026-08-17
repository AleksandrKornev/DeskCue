import type { DashboardHomeTab } from "./types";

export const dashboardHomeTabs = [
  { key: "chats", label: "Chats" },
  { key: "tools", label: "Tools" }
] satisfies Array<{ key: DashboardHomeTab; label: string }>;
