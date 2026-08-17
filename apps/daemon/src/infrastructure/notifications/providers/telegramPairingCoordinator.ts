import { randomUUID } from "node:crypto";

import type {
  TelegramNotificationPairingResolveResponse,
  TelegramNotificationPairingStartResponse,
  UpdateNotificationSettingsInput
} from "@deskcue/protocol";
import { AppError } from "#application/errors";

import { formatTelegramChatTitle, parseTelegramStartCode } from "./telegramNotifications.ts";
import { applyNotificationSettingsUpdate } from "../state/notificationSettings.ts";
import type {
  StoredNotificationSettings,
  TelegramGetMeResponse,
  TelegramPairingSession,
  TelegramUpdatesResponse
} from "../state/notificationTypes.ts";
import { TELEGRAM_PAIRING_TTL_MS } from "../state/notificationTypes.ts";

type TelegramApi = {
  request<T>(
    botToken: string,
    method: string,
    query?: Record<string, string>,
    signal?: AbortSignal,
    timeoutMs?: number
  ): Promise<T>;
};

type TelegramPairingCoordinatorOptions = {
  getSettings: () => StoredNotificationSettings;
  maxSessions?: number;
  requestTimeoutMs?: number;
  telegramApi: TelegramApi;
};

export function createTelegramPairingCoordinator({
  getSettings,
  maxSessions = 16,
  requestTimeoutMs = 10_000,
  telegramApi
}: TelegramPairingCoordinatorOptions) {
  const activeOperations = new Set<Promise<unknown>>();
  const controller = new AbortController();
  const pairingSessions = new Map<string, TelegramPairingSession>();
  let closePromise: Promise<void> | null = null;
  let pendingStarts = 0;

  const cleanupPairingSessions = () => {
    const now = Date.now();
    for (const [code, pairing] of pairingSessions) {
      if (pairing.expiresAtMs <= now) pairingSessions.delete(code);
    }
  };

  const resolveTelegramSettings = (
    settingsOverride?: UpdateNotificationSettingsInput
  ) => settingsOverride
    ? applyNotificationSettingsUpdate(getSettings(), settingsOverride)
    : getSettings();

  const getTelegramBotToken = (
    settingsOverride?: UpdateNotificationSettingsInput
  ) => {
    const botToken = resolveTelegramSettings(settingsOverride).providers.telegram.botToken.trim();
    if (!botToken) throw new Error("Telegram bot token is required.");
    return botToken;
  };

  function ensureOpen() {
    if (controller.signal.aborted) {
      throw new AppError("runtime_unavailable", "Telegram pairing is shutting down.");
    }
  }

  function track<T>(operation: Promise<T>) {
    activeOperations.add(operation);
    void operation.finally(() => activeOperations.delete(operation)).catch(() => {});
  }

  async function startTelegramPairing(
    settingsOverride?: UpdateNotificationSettingsInput
  ): Promise<TelegramNotificationPairingStartResponse> {
    ensureOpen();
    cleanupPairingSessions();
    if (pairingSessions.size + pendingStarts >= Math.max(1, maxSessions)) {
      throw new AppError(
        "conflict",
        "Too many Telegram pairing sessions are active. Finish or wait for an existing pairing to expire."
      );
    }

    const botToken = getTelegramBotToken(settingsOverride);
    pendingStarts += 1;
    const operation = telegramApi.request<TelegramGetMeResponse>(
      botToken,
      "getMe",
      undefined,
      controller.signal,
      requestTimeoutMs
    );
    track(operation);
    let bot: TelegramGetMeResponse;
    try {
      bot = await operation;
    } finally {
      pendingStarts = Math.max(0, pendingStarts - 1);
    }
    ensureOpen();
    const botUsername = bot.result.username?.trim();
    if (!botUsername) throw new Error("Telegram bot username was not returned by Bot API.");

    const code = randomUUID();
    const expiresAtMs = Date.now() + TELEGRAM_PAIRING_TTL_MS;
    pairingSessions.set(code, { botToken, botUsername, code, expiresAtMs });
    return {
      botUsername,
      code,
      deepLink: `https://t.me/${botUsername}?start=${code}`,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  async function resolveTelegramPairing(
    code: string
  ): Promise<TelegramNotificationPairingResolveResponse> {
    ensureOpen();
    cleanupPairingSessions();
    const pairing = pairingSessions.get(code);
    if (!pairing) throw new Error("Telegram pairing code expired. Start pairing again.");

    const operation = telegramApi.request<TelegramUpdatesResponse>(
      pairing.botToken,
      "getUpdates",
      {
        allowed_updates: JSON.stringify(["message"]),
        limit: "100",
        timeout: "0"
      },
      controller.signal,
      requestTimeoutMs
    );
    track(operation);
    const updates = await operation;
    ensureOpen();

    for (const update of updates.result) {
      const text = update.message?.text?.trim() ?? "";
      if (parseTelegramStartCode(text, pairing.botUsername) !== code) continue;
      const chat = update.message?.chat;
      if (chat?.id === undefined) continue;
      pairingSessions.delete(code);
      return {
        chatId: String(chat.id),
        chatTitle: formatTelegramChatTitle(chat)
      };
    }

    throw new Error(
      "Telegram start message was not found yet. Open the bot link and press Start, then try again."
    );
  }

  return {
    close() {
      if (closePromise) return closePromise;
      controller.abort(new Error("Telegram pairing coordinator is closing."));
      pairingSessions.clear();
      closePromise = (async () => {
        while (activeOperations.size > 0) {
          await Promise.allSettled([...activeOperations]);
        }
      })();
      return closePromise;
    },
    resolveTelegramPairing,
    startTelegramPairing
  };
}
