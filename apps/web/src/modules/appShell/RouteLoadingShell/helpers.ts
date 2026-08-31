import type { LoadingVariant } from "./types";

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function readLoadingVariant(pathname: string, search: string): LoadingVariant {
  const sessionMatch = pathname.match(/^\/([^/]+)\/[^/]+(?:\/[^/]+)?\/*$/);

  if (sessionMatch && decodePathSegment(sessionMatch[1]).toLowerCase() === "sessions") return "session";

  const agentSessionId = new URLSearchParams(search).get("agent");

  if (pathname === "/" && agentSessionId) return "session";

  return pathname === "/" ? "dashboard" : "page";
}

export function readLoadingStatusLabel(variant: LoadingVariant) {
  switch (variant) {
    case "dashboard":
      return "Loading DeskCue dashboard";
    case "page":
      return "Loading DeskCue page";
    case "session":
      return "Loading source-agent chat";
  }
}
