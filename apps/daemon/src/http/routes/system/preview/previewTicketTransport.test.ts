import type express from "express";
import assert from "node:assert/strict";
import test from "node:test";

import type { PreviewOwner } from "./previewTargetResolver.ts";
import {
  buildPreviewOwnerTicketCookieName,
  PREVIEW_TICKET_COOKIE_NAME
} from "./previewTicketRegistry.ts";
import {
  readPreviewTicket,
  readPreviewTicketCandidates,
  setPreviewTicketCookies
} from "./previewTicketTransport.ts";

function issueCookie(
  cookieHeader: string | undefined,
  owner: PreviewOwner,
  ticket: string
) {
  let issuedCookie = "";
  const request = {
    get: () => undefined,
    headers: { cookie: cookieHeader },
    protocol: "http",
    secure: false
  } as unknown as express.Request;
  const response = {
    cookie(name: string, value: string) {
      issuedCookie = `${name}=${value}`;
      return this;
    }
  } as unknown as express.Response;

  setPreviewTicketCookies(request, response, owner, ticket);
  return issuedCookie;
}

function createOwner(index: number): PreviewOwner {
  return { id: `owner-${index}`, kind: "session" };
}

function createTicket(index: number) {
  return `${String(index).padStart(3, "0")}${"A".repeat(40)}`;
}

test("keeps root Preview credentials in one bounded multi-owner cookie", () => {
  let cookieHeader: string | undefined;

  for (let index = 0; index < 20; index += 1) {
    const owner = createOwner(index);
    const ticket = createTicket(index);
    cookieHeader = issueCookie(cookieHeader, owner, ticket);
    assert.equal(readPreviewTicket("/", cookieHeader, owner), ticket);
  }

  assert.ok(cookieHeader);
  assert.equal(cookieHeader.split(";").length, 1);
  assert.ok(Buffer.byteLength(cookieHeader) < 2_100);
  const candidates = readPreviewTicketCandidates(cookieHeader);
  assert.equal(candidates.length, 8);
  assert.equal(candidates[0], createTicket(19));
  for (let index = 12; index < 20; index += 1) {
    assert.equal(readPreviewTicket("/", cookieHeader, createOwner(index)), createTicket(index));
  }
  assert.equal(readPreviewTicket("/", cookieHeader, createOwner(11)), null);
});

test("continues to read legacy generic and owner-scoped Preview cookies", () => {
  const owner = createOwner(1);
  const genericTicket = createTicket(1);
  assert.equal(
    readPreviewTicket("/", `${PREVIEW_TICKET_COOKIE_NAME}=${genericTicket}`, owner),
    genericTicket
  );

  const ownerTicket = createTicket(2);
  assert.equal(
    readPreviewTicket(
      "/",
      `${buildPreviewOwnerTicketCookieName(owner)}=${ownerTicket}`,
      owner
    ),
    ownerTicket
  );
});
