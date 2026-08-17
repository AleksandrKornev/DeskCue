import { setTimeout as delay } from "node:timers/promises";

import type { NotificationProviderKind } from "@deskcue/protocol";

import {
  formatExternalNotificationMessage,
  formatNtfyHeaderValue,
  formatTelegramNotification
} from "../delivery/notificationFormatters.ts";
import { MAX_EXTERNAL_NOTIFICATION_RECOVERY_RETRY_DELAY_MS } from "../state/notificationTypes.ts";
import type {
  NotificationPayload,
  StoredNotificationSettings
} from "../state/notificationTypes.ts";

type TelegramFetchWithFallback = typeof fetch & {
  fetchWithAttemptDeadline?: (
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
    timeoutMs: number
  ) => Promise<Response>;
};

export function resolveExternalNotificationRetryDelay(
  attempt: number,
  retryDelaysMs: number[],
  recoveryRetryDelayMs: number
) {
  const fastRetryDelay = retryDelaysMs[attempt - 2];
  if (fastRetryDelay !== undefined) return Math.max(0, fastRetryDelay);
  const recoveryAttempt = Math.max(0, attempt - retryDelaysMs.length - 2);
  return Math.min(
    Math.max(0, recoveryRetryDelayMs) * 2 ** recoveryAttempt,
    MAX_EXTERNAL_NOTIFICATION_RECOVERY_RETRY_DELAY_MS
  );
}

function parseHeadersText(value: string) {
  const headers: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const headerValue = line.slice(separatorIndex + 1).trim();
    if (key && headerValue) headers[key] = headerValue;
  }
  return headers;
}

async function assertOk(responseInput: Promise<Response> | Response) {
  const response = await responseInput;
  if (!response.ok) throw new Error(`Provider responded with HTTP ${response.status}.`);
}

function isTransientFetchError(error: unknown) {
  return error instanceof TypeError && error.message === "fetch failed";
}

async function fetchWithTransientRetry(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1]
) {
  try {
    return await fetchImpl(input, init);
  } catch (error) {
    if (!isTransientFetchError(error)) throw error;
    await delay(250, undefined, init?.signal ? { signal: init.signal } : undefined);
    return fetchImpl(input, init);
  }
}

function readUnknownErrorCause(error: unknown) {
  if (!error || typeof error !== "object" || !("cause" in error)) return null;
  return error.cause ?? null;
}

export function isNetworkTimeoutError(error: unknown): boolean {
  const cause = readUnknownErrorCause(error);
  if (cause && isNetworkTimeoutError(cause)) return true;
  if (
    error && typeof error === "object" && "code" in error &&
    (error.code === "ETIMEDOUT" || error.code === "UND_ERR_CONNECT_TIMEOUT")
  ) return true;
  return error instanceof Error && (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    error.message.includes("ETIMEDOUT")
  );
}

export function isRetryableNotificationDeliveryError(error: unknown): boolean {
  if (isNetworkTimeoutError(error)) return true;
  if (isTransientFetchError(error)) return true;
  const cause = readUnknownErrorCause(error);
  if (cause && isRetryableNotificationDeliveryError(cause)) return true;
  const message = error instanceof Error ? error.message : String(error);
  const httpStatusMatch = message.match(/\bHTTP\s+(\d{3})\b/);
  if (httpStatusMatch?.[1]) {
    const status = Number(httpStatusMatch[1]);
    return status === 408 || status === 429 || status >= 500;
  }
  return message.includes("network request failed");
}

function readSafeNetworkErrorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error &&
      typeof error.code === "string" && /^[A-Z0-9_.-]{1,64}$/.test(error.code)) {
    return error.code;
  }
  const cause = readUnknownErrorCause(error);
  return cause && cause !== error ? readSafeNetworkErrorCode(cause) : null;
}

function formatExternalFetchError(error: unknown) {
  const code = readSafeNetworkErrorCode(error);
  return code ? `network request failed (${code})` : "network request failed";
}

export async function fetchExternalProvider(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  label: string,
  options: { retryTransient?: boolean } = {}
) {
  try {
    return options.retryTransient === false
      ? await fetchImpl(input, init)
      : await fetchWithTransientRetry(fetchImpl, input, init);
  } catch (error) {
    throw new Error(`${label} request failed: ${formatExternalFetchError(error)}`, { cause: error });
  }
}

export async function sendExternalProvider(
  provider: Exclude<NotificationProviderKind, "web_push">,
  payload: NotificationPayload,
  fetchImpl: typeof fetch,
  settings: StoredNotificationSettings,
  fetchTelegramWithIpv4Fallback: TelegramFetchWithFallback,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
) {
  const telegramHasAttemptDeadline = provider === "telegram" &&
    typeof fetchTelegramWithIpv4Fallback.fetchWithAttemptDeadline === "function";
  const deadlineSignal = telegramHasAttemptDeadline ? null : options.timeoutMs
    ? AbortSignal.timeout(Math.max(1, options.timeoutMs))
    : null;
  const signal = options.signal && deadlineSignal
    ? AbortSignal.any([options.signal, deadlineSignal])
    : options.signal ?? deadlineSignal ?? undefined;
  if (provider === "ntfy") {
    const topicUrl = settings.providers.ntfy.topicUrl.trim();
    if (!topicUrl) throw new Error("ntfy topic URL is not configured.");
    await assertOk(fetchExternalProvider(fetchImpl, topicUrl, {
      body: formatExternalNotificationMessage(payload),
      headers: { Priority: "default", Tags: "deskcue", Title: formatNtfyHeaderValue(payload.title) },
      method: "POST",
      signal
    }, "ntfy notification", { retryTransient: false }));
    return;
  }

  if (provider === "gotify") {
    const serverUrl = settings.providers.gotify.serverUrl.trim().replace(/\/$/, "");
    const token = settings.providers.gotify.token.trim();
    if (!serverUrl || !token) throw new Error("Gotify server URL and token are required.");
    const url = new URL(`${serverUrl}/message`);
    url.searchParams.set("token", token);
    await assertOk(fetchExternalProvider(fetchImpl, url, {
      body: JSON.stringify({ message: formatExternalNotificationMessage(payload), priority: 5, title: payload.title }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal
    }, "Gotify notification", { retryTransient: false }));
    return;
  }

  if (provider === "telegram") {
    const botToken = settings.providers.telegram.botToken.trim();
    const chatId = settings.providers.telegram.chatId.trim();
    if (!botToken || !chatId) throw new Error("Telegram bot token and chat id are required.");
    const telegramRequest = {
      body: JSON.stringify({
        chat_id: chatId,
        disable_web_page_preview: true,
        text: formatTelegramNotification(payload),
        parse_mode: "MarkdownV2"
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal
    } satisfies RequestInit;
    const sendTelegram = fetchTelegramWithIpv4Fallback.fetchWithAttemptDeadline
      ? (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) =>
        fetchTelegramWithIpv4Fallback.fetchWithAttemptDeadline!(
          input,
          init,
          Math.max(1, options.timeoutMs ?? 10_000)
        )
      : fetchTelegramWithIpv4Fallback;
    await assertOk(fetchExternalProvider(
      sendTelegram,
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      telegramRequest,
      "Telegram notification"
    ));
    return;
  }

  const url = settings.providers.webhook.url.trim();
  if (!url) throw new Error("Webhook URL is not configured.");
  await assertOk(fetchExternalProvider(fetchImpl, url, {
    body: JSON.stringify(payload.webhookBody ?? payload),
    headers: { "content-type": "application/json", ...parseHeadersText(settings.providers.webhook.headersText) },
    method: "POST",
    signal
  }, "Webhook notification", { retryTransient: false }));
}
