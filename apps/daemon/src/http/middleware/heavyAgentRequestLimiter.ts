import type express from "express";

import { getRequestAccessDevice, readRequestIp } from "#access/accessDevices";
import { daemonConfig } from "#config/daemonConfig";

type RateLimitWindow = {
  resetAt: number;
  timestamps: number[];
};

const heavyAgentRequestWindows = new Map<string, RateLimitWindow>();

export function resetHeavyAgentRequestLimiterForTests() {
  heavyAgentRequestWindows.clear();
}

function readHeavyAgentRequestClientKey(request: express.Request) {
  const accessDevice = getRequestAccessDevice(request);
  return accessDevice ? `device:${accessDevice.id}` : `ip:${readRequestIp(request)}`;
}

function pruneHeavyAgentRequestWindows(now: number) {
  for (const [key, window] of heavyAgentRequestWindows.entries()) {
    if (window.resetAt <= now) {
      heavyAgentRequestWindows.delete(key);
    }
  }
}

function takeHeavyAgentRequestBudget(clientKey: string, bucket: string) {
  const now = Date.now();
  const limit = daemonConfig.heavyAgentRequestRateLimitMax;
  const windowMs = daemonConfig.heavyAgentRequestRateLimitWindowMs;
  const key = `${clientKey}\u0000${bucket}`;
  const existing = heavyAgentRequestWindows.get(key);
  const timestamps = existing?.resetAt && existing.resetAt > now
    ? existing.timestamps.filter((timestamp) => now - timestamp < windowMs)
    : [];
  const resetAt = timestamps[0] !== undefined ? timestamps[0] + windowMs : now + windowMs;

  if (timestamps.length >= limit) {
    heavyAgentRequestWindows.set(key, {
      resetAt,
      timestamps
    });
    pruneHeavyAgentRequestWindows(now);
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt
    };
  }

  timestamps.push(now);
  const nextResetAt = timestamps[0] + windowMs;
  heavyAgentRequestWindows.set(key, {
    resetAt: nextResetAt,
    timestamps
  });
  pruneHeavyAgentRequestWindows(now);

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - timestamps.length),
    resetAt: nextResetAt
  };
}

export function requireHeavyAgentRequestBudget(
  request: express.Request,
  response: express.Response,
  bucket: string
) {
  const result = takeHeavyAgentRequestBudget(readHeavyAgentRequestClientKey(request), bucket);
  response.setHeader("RateLimit-Limit", String(result.limit));
  response.setHeader("RateLimit-Remaining", String(result.remaining));
  response.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));

  if (result.allowed) {
    return true;
  }

  response.setHeader("Retry-After", String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
  response.status(429).json({
    error: "Too many heavy agent requests. Try again shortly."
  });
  return false;
}
