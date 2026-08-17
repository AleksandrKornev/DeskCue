import type { LoadingVariant } from "./types";

export function readLoadingVariant(pathname: string, search: string): LoadingVariant {
  if (/^\/sessions\/[^/]+/.test(pathname)) {
    return "session";
  }

  if (pathname === "/" && new URLSearchParams(search).has("agent")) {
    return "session";
  }

  return pathname === "/" ? "dashboard" : "page";
}
