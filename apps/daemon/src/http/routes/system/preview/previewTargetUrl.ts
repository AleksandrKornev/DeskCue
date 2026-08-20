type PreviewTargetUrlOptions = {
  basePath?: string;
  isDeskCueAccessToken: (value: string) => boolean;
  ticketPathSegment: string;
  ticketQueryKey: string;
};

const ACCESS_TOKEN_QUERY_KEYS = ["access_token", "token"] as const;

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
  incoming.searchParams.delete(ticketQueryKey);
  for (const key of ACCESS_TOKEN_QUERY_KEYS) {
    const value = incoming.searchParams.get(key);
    if (value && isDeskCueAccessToken(value)) incoming.searchParams.delete(key);
  }

  const sourcePath = basePath && incoming.pathname.startsWith(basePath)
    ? incoming.pathname.slice(basePath.length)
    : incoming.pathname;
  const withoutTicketPath = sourcePath.replace(
    new RegExp(`^/?${ticketPathSegment}/[^/]+`),
    ""
  );
  const pathname = `/${withoutTicketPath.replace(/^\/+/, "")}`.replace(/\\/g, "/");
  return new URL(`${pathname}${incoming.search}`, origin);
}
