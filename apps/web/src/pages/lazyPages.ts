import { lazy } from "react";

export const AccessRequiredPage = lazy(() =>
  import("./AccessRequiredPage").then((module) => ({
    default: module.AccessRequiredPage
  }))
);

export const LogsPage = lazy(() =>
  import("./LogsPage").then((module) => ({
    default: module.LogsPage
  }))
);

export const SettingsPage = lazy(() =>
  import("./SettingsPage/index").then((module) => ({
    default: module.SettingsPage
  }))
);
