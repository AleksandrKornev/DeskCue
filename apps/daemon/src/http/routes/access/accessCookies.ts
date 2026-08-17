import type express from "express";
import type { IncomingMessage } from "node:http";

import { daemonConfig } from "#config/daemonConfig";

export const ACCESS_TOKEN_COOKIE_NAME = "deskcue_access";

const ACCESS_TOKEN_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function isSecureRequest(request: express.Request) {
  if (daemonConfig.cookieSecure !== "auto") {
    return daemonConfig.cookieSecure;
  }

  return (
    request.secure ||
    request.protocol === "https" ||
    request.get("x-forwarded-proto") === "https"
  );
}

export function setAccessTokenCookie(
  request: express.Request,
  response: express.Response,
  accessToken: string
) {
  response.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
    httpOnly: true,
    maxAge: ACCESS_TOKEN_COOKIE_MAX_AGE_MS,
    path: "/",
    sameSite: "lax",
    secure: isSecureRequest(request)
  });
}

export function clearAccessTokenCookie(
  request: express.Request,
  response: express.Response
) {
  response.clearCookie(ACCESS_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: isSecureRequest(request)
  });
}

function readCookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValueParts] = part.trim().split("=");
    if (rawKey !== name) {
      continue;
    }

    const rawValue = rawValueParts.join("=");
    if (!rawValue) {
      return null;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

export function readAccessTokenCookie(request: express.Request | IncomingMessage) {
  return readCookieValue(request.headers.cookie, ACCESS_TOKEN_COOKIE_NAME);
}
