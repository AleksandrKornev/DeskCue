import { readConnectionEpoch } from "@api/connection/events";
import type { ApiErrorPayload } from "@api/transport/errors";
import { getDeskCueRuntime } from "@runtime";

import { isApiRequestCanceled, isAxiosStatus, readAxiosStatus } from "./errors";
import { readApiResultFailure, throwApiRequestError } from "./requestFailure";

type DataResponse<TData> = Promise<{ data: TData; status: number }>;

export type ApiResult<TData> =
  | { readonly data: TData; readonly ok: true; readonly status?: number }
  | { readonly data: ApiErrorPayload; readonly ok: false; readonly status?: number | null };

export async function readRequestData<TData>(
  request: () => DataResponse<TData>,
  fallbackMessage: string
) {
  const requestEpoch = readConnectionEpoch();
  const requestRuntime = getDeskCueRuntime();
  try {
    return (await request()).data;
  } catch (error) {
    throwApiRequestError(error, fallbackMessage, requestEpoch, requestRuntime);
  }
}

export async function readNullableRequestData<TData>(
  request: () => DataResponse<TData>,
  fallbackMessage: string
) {
  const requestEpoch = readConnectionEpoch();
  const requestRuntime = getDeskCueRuntime();
  try {
    return (await request()).data;
  } catch (error) {
    if (isApiRequestCanceled(error) || isAxiosStatus(error, 401)) {
      throwApiRequestError(error, fallbackMessage, requestEpoch, requestRuntime);
    }

    if (isAxiosStatus(error, 404)) {
      return null;
    }

    throwApiRequestError(error, fallbackMessage, requestEpoch, requestRuntime);
  }
}

export async function readApiResult<TData>(
  request: () => DataResponse<TData>
): Promise<ApiResult<TData>> {
  const requestEpoch = readConnectionEpoch();
  const requestRuntime = getDeskCueRuntime();
  try {
    const response = await request();
    return {
      ok: true,
      data: response.data,
      status: response.status
    } as const;
  } catch (error) {
    return {
      ok: false,
      data: readApiResultFailure(error, requestEpoch, requestRuntime),
      status: readAxiosStatus(error)
    } as const;
  }
}
