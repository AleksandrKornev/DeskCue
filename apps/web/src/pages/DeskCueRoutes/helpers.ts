import { safelyDecodeUriComponent } from "@lib/url";
import { parseSessionTab } from "@models/dashboardRoute";

export function readRouteSessionId(pathname: string) {
  const match = /^\/sessions\/([^/]+)/.exec(pathname);
  return match ? safelyDecodeUriComponent(match[1]) : null;
}

export function readRouteSessionTab(pathname: string) {
  const match = /^\/sessions\/[^/]+\/([^/]+)/.exec(pathname);
  return parseSessionTab(match?.[1]);
}
