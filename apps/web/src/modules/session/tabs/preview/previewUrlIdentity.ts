const PREVIEW_TICKET_PATH_PATTERN = /\/__deskcue_ticket__\/[^/?#]+/;
const PREVIEW_TICKET_QUERY_KEY = "deskcuePreviewTicket";
const RELATIVE_PREVIEW_URL_ORIGIN = "http://deskcue.invalid";

function hasPreviewTicketCredential(previewUrl: string) {
  try {
    const url = new URL(previewUrl, RELATIVE_PREVIEW_URL_ORIGIN);
    return PREVIEW_TICKET_PATH_PATTERN.test(url.pathname) ||
      url.searchParams.has(PREVIEW_TICKET_QUERY_KEY);
  } catch {
    return PREVIEW_TICKET_PATH_PATTERN.test(previewUrl) ||
      previewUrl.includes(`${PREVIEW_TICKET_QUERY_KEY}=`);
  }
}

export function getPreviewDocumentIdentity(previewUrl: string | null) {
  if (!previewUrl) return "";

  try {
    const url = new URL(previewUrl, RELATIVE_PREVIEW_URL_ORIGIN);
    url.pathname = url.pathname.replace(PREVIEW_TICKET_PATH_PATTERN, "");
    url.searchParams.delete(PREVIEW_TICKET_QUERY_KEY);

    const origin = url.origin === RELATIVE_PREVIEW_URL_ORIGIN ? "" : url.origin;
    return `${origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return previewUrl
      .replace(PREVIEW_TICKET_PATH_PATTERN, "")
      .replace(/([?&])deskcuePreviewTicket=[^&#]*&?/, (_match, separator: string) => (
        separator === "?" ? "?" : ""
      ))
      .replace(/[?&]$/, "");
  }
}

export function resolvePreviewFrameUrl(currentUrl: string | null, nextUrl: string | null) {
  if (!currentUrl || !nextUrl) return nextUrl;
  if (getPreviewDocumentIdentity(currentUrl) !== getPreviewDocumentIdentity(nextUrl)) {
    return nextUrl;
  }
  if (hasPreviewTicketCredential(currentUrl) && !hasPreviewTicketCredential(nextUrl)) {
    return nextUrl;
  }
  return currentUrl;
}
