import { describe, expect, it } from "vitest";

import {
  getPreviewDocumentIdentity,
  resolvePreviewFrameUrl
} from "./previewUrlIdentity";

describe("getPreviewDocumentIdentity", () => {
  it("ignores the current path ticket while preserving the preview document path", () => {
    expect(getPreviewDocumentIdentity(
      "/api/preview/sessions/session-1/__deskcue_ticket__/ticket-1/dashboard?view=wide"
    )).toBe("/api/preview/sessions/session-1/dashboard?view=wide");
  });

  it("ignores a legacy query ticket without losing other query parameters", () => {
    expect(getPreviewDocumentIdentity(
      "https://deskcue.example/api/preview/sessions/session-1/?view=wide&deskcuePreviewTicket=ticket-1"
    )).toBe("https://deskcue.example/api/preview/sessions/session-1/?view=wide");
  });

  it("keeps routing changes distinct", () => {
    expect(getPreviewDocumentIdentity(
      "/api/preview/sessions/session-1/__deskcue_ticket__/ticket-1/"
    )).not.toBe(getPreviewDocumentIdentity(
      "/api/preview/sessions/session-2/__deskcue_ticket__/ticket-2/"
    ));
  });
});

describe("resolvePreviewFrameUrl", () => {
  it("keeps the mounted frame URL while only a legacy ticket rotates", () => {
    const currentUrl = "/api/preview/sessions/session-1/__deskcue_ticket__/ticket-1/";
    expect(resolvePreviewFrameUrl(
      currentUrl,
      "/api/preview/sessions/session-1/__deskcue_ticket__/ticket-2/"
    )).toBe(currentUrl);
  });

  it("adopts a stable URL when replacing a legacy bootstrap ticket", () => {
    expect(resolvePreviewFrameUrl(
      "/api/preview/sessions/session-1/__deskcue_ticket__/ticket-1/",
      "/api/preview/sessions/session-1/"
    )).toBe("/api/preview/sessions/session-1/");
  });

  it("adopts a different owner URL", () => {
    expect(resolvePreviewFrameUrl(
      "/api/preview/sessions/session-1/",
      "/api/preview/sessions/session-2/"
    )).toBe("/api/preview/sessions/session-2/");
  });
});
