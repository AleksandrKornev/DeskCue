import { isApiHttpStatusError, isApiRequestCanceled, isApiUnauthorizedError } from "@api/transport/errors";
import type { AgentChatDetailLoadOptions } from "@modules/dashboard/model/chatDetail/resource/agentChatDetailTypes";

export type AgentChatDetailRefreshPolicyOptions = {
  maxRetryAttempts: number;
  random: () => number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
};

export function shouldRetryAgentChatDetailError(error: unknown) {
  if (isApiRequestCanceled(error) || isApiUnauthorizedError(error)) {
    return false;
  }

  if (!isApiHttpStatusError(error)) {
    return true;
  }

  if ([401, 403, 404].includes(error.status)) {
    return false;
  }

  return error.status === 408 || error.status === 429 || error.status >= 500;
}

export class AgentChatDetailRefreshPolicy {
  constructor(private readonly options: AgentChatDetailRefreshPolicyOptions) {}

  canRetry(attempt: number, error?: unknown) {
    return attempt < this.options.maxRetryAttempts &&
      (!error || shouldRetryAgentChatDetailError(error));
  }

  resolveRetryDelay(attempt: number, minimumDelayMs = 0) {
    const exponentialDelay = this.options.retryBaseDelayMs * (2 ** Math.max(0, attempt - 1));
    const jitterDelay = Math.floor(this.options.random() * this.options.retryBaseDelayMs);
    return Math.max(
      minimumDelayMs,
      Math.min(this.options.retryMaxDelayMs, exponentialDelay + jitterDelay)
    );
  }
}

export function getLiveDetailNetworkThrottleIntervalMs(
  options: AgentChatDetailLoadOptions
) {
  if (options.force || options.bypassDedupe || !options.minimumUpdatedAt) {
    return 0;
  }

  return Math.max(0, options.minNetworkIntervalMs ?? 0);
}

export function getLiveDetailRetryDelayFloorMs(options: AgentChatDetailLoadOptions) {
  return options.minimumUpdatedAt
    ? Math.max(0, options.minNetworkIntervalMs ?? 0)
    : 0;
}
