import { lazy } from "react";

export const DashboardPage = lazy(() =>
  import("@pages/DashboardPage").then((module) => ({
    default: module.DashboardPage
  }))
);

export const LocalLlmChatPage = lazy(() =>
  import("@pages/LocalLlmChatPage/LocalLlmChatPage").then((module) => ({
    default: module.LocalLlmChatPage
  }))
);

export const ManagedSessionPage = lazy(() =>
  import("@pages/ManagedSessionPage").then((module) => ({
    default: module.ManagedSessionPage
  }))
);
