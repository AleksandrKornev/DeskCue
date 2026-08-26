type PreviewTargetUrlOptions = {
  basePath?: string;
  isDeskCueAccessToken: (value: string) => boolean;
  ticketPathSegment: string;
  ticketQueryKey: string;
};

const ACCESS_TOKEN_QUERY_KEYS = ["access_token", "token"] as const;

function readQuerySegmentKey(segment: string) {
  return new URLSearchParams(segment).keys().next().value ?? "";
}

function sanitizePreviewSearch(
  search: string,
  ticketQueryKey: string,
  isDeskCueAccessToken: (value: string) => boolean
) {
  if (!search) return "";

  const searchParams = new URLSearchParams(search);
  const removedKeys = new Set<string>([ticketQueryKey]);

  for (const key of ACCESS_TOKEN_QUERY_KEYS) {
    const value = searchParams.get(key);

    if (value && isDeskCueAccessToken(value)) removedKeys.add(key);
  }

  const sanitizedQuery = search.slice(1)
    .split("&")
    .filter((segment) => !removedKeys.has(readQuerySegmentKey(segment)))
    .join("&");
  return sanitizedQuery ? `?${sanitizedQuery}` : "";
}

export function buildPreviewTargetUrl(
  requestUrl: string,
  origin: string,
  {
    basePath,
    isDeskCueAccessToken,
    ticketPathSegment,
    ticketQueryKey
  }: PreviewTargetUrlOptions
) {
  const incoming = new URL(requestUrl || "/", "http://deskcue.local");
  const sanitizedSearch = sanitizePreviewSearch(
    incoming.search,
    ticketQueryKey,
    isDeskCueAccessToken
  );

  const sourcePath = basePath && incoming.pathname.startsWith(basePath)
    ? incoming.pathname.slice(basePath.length)
    : incoming.pathname;
  const withoutTicketPath = sourcePath.replace(
    new RegExp(`^/?${ticketPathSegment}/[^/]+`),
    ""
  );
  const pathname = `/${withoutTicketPath.replace(/^\/+/, "")}`.replace(/\\/g, "/");

  return new URL(`${pathname}${sanitizedSearch}`, origin);
}
