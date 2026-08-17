import {
  emitUnauthorizedEvent,
  readConnectionEpoch
} from "@api/connection/events";
import { getDeskCueRuntime } from "@runtime";
import type { DeskCueRuntime } from "@runtime";

import {
  ApiHttpStatusError,
  ApiUnauthorizedError,
  isApiRequestCanceled,
  isAxiosStatus,
  readAxiosErrorMessage,
  readAxiosErrorPayload,
  readAxiosStatus
} from "./errors";

const UNAUTHORIZED_FALLBACK = "DeskCue access token is required";

function createApiHttpError(error: unknown, fallbackMessage: string) {
  const status = readAxiosStatus(error);
  if (!status) {
    return new Error(readAxiosErrorMessage(error, fallbackMessage));
  }

  return new ApiHttpStatusError(
    status,
    readAxiosErrorMessage(error, fallbackMessage),
    readAxiosErrorPayload(error)
  );
}

export function throwApiRequestError(
  error: unknown,
  fallbackMessage: string,
  requestEpoch = readConnectionEpoch(),
  requestRuntime: DeskCueRuntime = getDeskCueRuntime()
): never {
  if (isApiRequestCanceled(error)) {
    throw error;
  }

  if (isAxiosStatus(error, 401)) {
    if (requestRuntime === getDeskCueRuntime()) {
      emitUnauthorizedEvent(requestEpoch);
    }
    throw new ApiUnauthorizedError(readAxiosErrorMessage(error, UNAUTHORIZED_FALLBACK));
  }

  throw createApiHttpError(error, fallbackMessage);
}

export function readApiResultFailure(
  error: unknown,
  requestEpoch = readConnectionEpoch(),
  requestRuntime: DeskCueRuntime = getDeskCueRuntime()
) {
  if (isAxiosStatus(error, 401)) {
    if (requestRuntime === getDeskCueRuntime()) {
      emitUnauthorizedEvent(requestEpoch);
    }
  }

  return readAxiosErrorPayload(error);
}
