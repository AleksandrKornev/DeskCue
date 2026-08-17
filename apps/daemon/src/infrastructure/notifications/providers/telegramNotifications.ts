import { Agent, fetch as undiciFetch } from "undici";

import { logger } from "#infrastructure/logging/logger";

import { fetchExternalProvider, isNetworkTimeoutError } from "./externalNotificationProviders.ts";
import type { TelegramUpdate } from "../state/notificationTypes.ts";

const telegramIpv4Dispatcher = new Agent({ connect: { family: 4 } });

export const fetchTelegramOverIpv4: typeof fetch = ((input, init) =>
  undiciFetch(input as never, {
    ...init,
    dispatcher: telegramIpv4Dispatcher
  } as never) as unknown as Promise<Response>);

type TelegramFetchWithFallback = typeof fetch & {
  fetchWithAttemptDeadline?: (
    input: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
    timeoutMs: number
  ) => Promise<Response>;
};

export function parseTelegramStartCode(text: string, botUsername: string) {
  const directMatch = text.match(/^\/start\s+([A-Za-z0-9_-]{1,64})$/);
  if (directMatch) return directMatch[1];
  const botMatch = text.match(/^\/start@([A-Za-z0-9_]{5,32})\s+([A-Za-z0-9_-]{1,64})$/);
  if (botMatch?.[1]?.toLowerCase() === botUsername.toLowerCase()) return botMatch[2];
  return null;
}

function combineAbortSignals(parent: AbortSignal | null | undefined, deadline: AbortSignal) {
  return parent ? AbortSignal.any([parent, deadline]) : deadline;
}

export function createTelegramApiClient(
  fetchImpl: typeof fetch,
  ipv4FetchImpl: typeof fetch
) {
  const fetchWithIpv4Fallback: TelegramFetchWithFallback = async (input, init) => {
    try {
      return await fetchImpl(input, init);
    } catch (error) {
      if (!isNetworkTimeoutError(error)) throw error;
      logger.info("Retrying Telegram request over IPv4 after network timeout");
      return ipv4FetchImpl(input, init);
    }
  };

  fetchWithIpv4Fallback.fetchWithAttemptDeadline = async (input, init, timeoutMs) => {
    const runAttempt = (requestFetch: typeof fetch) => requestFetch(input, {
      ...init,
      signal: combineAbortSignals(init?.signal, AbortSignal.timeout(Math.max(1, timeoutMs)))
    });

    try {
      return await runAttempt(fetchImpl);
    } catch (error) {
      if (!isNetworkTimeoutError(error) || init?.signal?.aborted) throw error;
      logger.info("Retrying Telegram request over IPv4 after network timeout");
      return runAttempt(ipv4FetchImpl);
    }
  };

  return {
    fetchWithIpv4Fallback,
    async request<T>(
      botToken: string,
      method: string,
      searchParams?: Record<string, string>,
      signal?: AbortSignal,
      timeoutMs = 10_000
    ): Promise<T> {
      const url = new URL(`https://api.telegram.org/bot${botToken}/${method}`);
      for (const [key, value] of Object.entries(searchParams ?? {})) url.searchParams.set(key, value);
      const response = await fetchExternalProvider(
        (input, init) => fetchWithIpv4Fallback.fetchWithAttemptDeadline!(
          input,
          init,
          Math.max(1, timeoutMs)
        ),
        url,
        signal ? { signal } : undefined,
        "Telegram Bot API"
      );
      let payload: ({ ok?: boolean; description?: string } & T) | null = null;
      try {
        payload = await response.json() as ({ ok?: boolean; description?: string } & T);
      } catch {
        // Telegram normally returns JSON; the stable error below covers invalid proxy responses.
      }
      if (!response.ok || payload?.ok === false) {
        throw new Error(`Telegram Bot API request failed with HTTP ${response.status}.`);
      }
      if (!payload) throw new Error("Telegram returned an invalid response.");
      return payload;
    }
  };
}

export function formatTelegramChatTitle(chat: NonNullable<TelegramUpdate["message"]>["chat"]) {
  if (!chat) return null;
  if (chat.title?.trim()) return chat.title.trim();
  if (chat.username?.trim()) return `@${chat.username.trim()}`;
  if (chat.first_name?.trim()) return chat.first_name.trim();
  return null;
}
