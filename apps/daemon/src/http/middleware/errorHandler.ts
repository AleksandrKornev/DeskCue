import type express from "express";

import { getErrorResponse } from "#application/errors";
import { logger } from "#infrastructure/logging/logger";

function isPayloadTooLarge(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "type" in error &&
    error.type === "entity.too.large"
  );
}

export function errorHandler(
  error: unknown,
  request: express.Request,
  response: express.Response,
  _next: express.NextFunction
) {
  const errorResponse = isPayloadTooLarge(error)
    ? {
        code: "payload_too_large",
        message: "Request payload exceeds the allowed size.",
        statusCode: 413
      }
    : getErrorResponse(error);
  logger.error("HTTP request failed", {
    requestId: typeof response.locals.requestId === "string" ? response.locals.requestId : null,
    method: request.method,
    path: request.path,
    code: errorResponse.code,
    message: errorResponse.message
  });
  response.status(errorResponse.statusCode).json({
    error: errorResponse.message
  });
}
