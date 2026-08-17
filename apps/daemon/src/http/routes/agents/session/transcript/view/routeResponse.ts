import type express from "express";

import { sendJsonWithEtag, sendNotModifiedIfMatched } from "../../jsonResponse.ts";
import type { JsonResponseOptions } from "../../jsonResponse.ts";

export function sendTranscriptNotModifiedIfMatched(
  request: express.Request,
  response: express.Response,
  etag: string
) {
  return sendNotModifiedIfMatched(request, response, etag);
}

export async function sendTranscriptJsonWithEtag(
  response: express.Response,
  payload: unknown,
  etag: string,
  options: JsonResponseOptions
) {
  await sendJsonWithEtag(response, payload, etag, options);
}

export function sendAgentSessionNotFound(response: express.Response) {
  response.status(404).json({
    error: "Agent session not found."
  });
}
