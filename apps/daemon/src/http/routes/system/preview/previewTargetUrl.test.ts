import assert from "node:assert/strict";
import test from "node:test";

import { buildPreviewTargetUrl } from "./previewTargetUrl.ts";

const options = {
  basePath: "/api/preview/sessions/session-1",
  isDeskCueAccessToken: (value: string) => value === "deskcue-device-token",
  ticketPathSegment: "__deskcue_ticket__",
  ticketQueryKey: "deskcuePreviewTicket"
};

test("preserves Vite and application query tokens for the preview target", () => {
  const target = buildPreviewTargetUrl(
    "/api/preview/sessions/session-1/?token=vite-hmr-token&access_token=application-token",
    "http://127.0.0.1:5173",
    options
  );

  assert.equal(
    target.href,
    "http://127.0.0.1:5173/?token=vite-hmr-token&access_token=application-token"
  );
});

test("preserves bare query flags while removing authenticated DeskCue credentials", () => {
  const target = buildPreviewTargetUrl(
    "/api/preview/sessions/session-1/__deskcue_ticket__/path-ticket/src/icon.svg" +
      "?import&react&access_token=deskcue-device-token&token=public-token&empty=&flag",
    "http://127.0.0.1:5173",
    options
  );

  assert.equal(
    target.href,
    "http://127.0.0.1:5173/src/icon.svg?import&react&token=public-token&empty=&flag"
  );
});

test("strips only authenticated DeskCue credentials and Preview ticket transport", () => {
  const target = buildPreviewTargetUrl(
    "/api/preview/sessions/session-1/__deskcue_ticket__/path-ticket/socket" +
      "?token=deskcue-device-token&access_token=application-token&deskcuePreviewTicket=query-ticket",
    "http://127.0.0.1:5173",
    options
  );

  assert.equal(
    target.href,
    "http://127.0.0.1:5173/socket?access_token=application-token"
  );
});
