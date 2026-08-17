import type Database from "better-sqlite3";
import type express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  AccessDeviceSummary,
  RevokeAccessDevicesResponse,
  UpdateAccessDeviceResponse
} from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";
import { readRequestClientAddress } from "#http/hostClient";
import {
  getProductionSqliteDatabaseContext,
  initializeSqliteDatabaseContext
} from "#persistence/connection/sqliteConnection";
import type {
  SqliteDatabaseContext,
  SqliteDatabaseSource
} from "#persistence/connection/sqliteConnection";

type AccessDeviceRow = {
  id: string;
  token_hash: string;
  label: string;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_ip: string | null;
  revoked_at: string | null;
};

type AccessRecoveryCodeRow = {
  id: string;
  code_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};

export type AuthenticatedAccessDevice = {
  id: string;
  label: string;
};

const ACCESS_DEVICE_CONTEXT = Symbol("deskcue.accessDevice");
const LAST_SEEN_UPDATE_INTERVAL_MS = 60_000;
const ACCESS_RECOVERY_CODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REVOKED_ACCESS_DEVICE_ROWS = 50;

export function setRequestAccessDevice(
  request: express.Request,
  device: AuthenticatedAccessDevice | null
) {
  (request as express.Request & { [ACCESS_DEVICE_CONTEXT]?: AuthenticatedAccessDevice | null })[
    ACCESS_DEVICE_CONTEXT
  ] = device;
}

export function getRequestAccessDevice(request: express.Request) {
  return (request as express.Request & {
    [ACCESS_DEVICE_CONTEXT]?: AuthenticatedAccessDevice | null;
  })[ACCESS_DEVICE_CONTEXT] ?? null;
}

export function readRequestIp(request: express.Request) {
  return readRequestClientAddress(request) || null;
}

export function buildDeviceLabel(userAgent: string | null) {
  if (!userAgent) {
    return "DeskCue device";
  }

  if (userAgent.includes("Mobile")) {
    return "Mobile device";
  }

  if (userAgent.includes("Chrome")) {
    return "Chrome browser";
  }

  if (userAgent.includes("Firefox")) {
    return "Firefox browser";
  }

  if (userAgent.includes("Safari")) {
    return "Safari browser";
  }

  return "DeskCue browser";
}

function createDeviceToken() {
  return `dcd_${randomBytes(32).toString("base64url")}`;
}

function createRecoveryCode() {
  return randomBytes(18)
    .toString("base64url")
    .replace(/(.{6})/g, "$1-")
    .replace(/-$/, "")
    .toUpperCase();
}

function normalizeRecoveryCode(code: string) {
  return code.trim().replace(/[\s-]+/g, "").toUpperCase();
}

function hashAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function mapDeviceRow(
  row: AccessDeviceRow,
  currentDeviceId: string | null
): AccessDeviceSummary {
  return {
    id: row.id,
    label: row.label,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    lastIp: row.last_ip,
    revokedAt: row.revoked_at,
    current: row.id === currentDeviceId
  };
}

export class AccessDeviceStore {
  private readonly database: Database.Database;
  private readonly databaseContext: SqliteDatabaseContext;
  private readonly ownsDatabaseContext: boolean;
  private readonly lastSeenUpdates = new Map<string, number>();

  constructor(
    source: SqliteDatabaseSource = getProductionSqliteDatabaseContext(
      daemonConfig.databaseFilePath
    )
  ) {
    const resolved = initializeSqliteDatabaseContext(source);
    this.databaseContext = resolved.context;
    this.ownsDatabaseContext = resolved.ownsContext;
    this.database = resolved.context.database;
    this.pruneRevokedDevices();
  }

  createDevice({
    ip,
    label,
    userAgent
  }: {
    ip: string | null;
    label: string;
    userAgent: string | null;
  }) {
    const accessToken = createDeviceToken();
    const now = new Date().toISOString();
    const device = {
      id: randomUUID(),
      tokenHash: hashAccessToken(accessToken),
      label,
      userAgent,
      createdAt: now,
      lastSeenAt: now,
      lastIp: ip,
      revokedAt: null
    };

    this.database.prepare(`
      INSERT INTO access_devices (
        id, token_hash, label, user_agent, created_at, last_seen_at, last_ip, revoked_at
      )
      VALUES (
        @id, @tokenHash, @label, @userAgent, @createdAt, @lastSeenAt, @lastIp, @revokedAt
      )
    `).run(device);

    return {
      accessToken,
      device: {
        id: device.id,
        label: device.label
      } satisfies AuthenticatedAccessDevice
    };
  }

  createRecoveryCode() {
    const code = createRecoveryCode();
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ACCESS_RECOVERY_CODE_TTL_MS).toISOString();

    this.pruneExpiredRecoveryCodes(now);
    this.database.prepare(`
      INSERT INTO access_recovery_codes (
        id, code_hash, created_at, expires_at, used_at
      )
      VALUES (
        @id, @codeHash, @createdAt, @expiresAt, NULL
      )
    `).run({
      id: randomUUID(),
      codeHash: hashAccessToken(normalizeRecoveryCode(code)),
      createdAt: now,
      expiresAt
    });

    return {
      code,
      expiresAt
    };
  }

  redeemRecoveryCode({
    code,
    ip,
    userAgent
  }: {
    code: string;
    ip: string | null;
    userAgent: string | null;
  }) {
    const now = new Date().toISOString();
    const row = this.database.prepare(`
      SELECT id, code_hash, created_at, expires_at, used_at
      FROM access_recovery_codes
      WHERE code_hash = ? AND used_at IS NULL
      LIMIT 1
    `).get(hashAccessToken(normalizeRecoveryCode(code))) as AccessRecoveryCodeRow | undefined;

    if (!row || row.expires_at < now) {
      return null;
    }

    const result = this.database.prepare(`
      UPDATE access_recovery_codes
      SET used_at = ?
      WHERE id = ? AND used_at IS NULL
    `).run(now, row.id);

    if (result.changes === 0) {
      return null;
    }

    return this.createDevice({
      ip,
      label: buildDeviceLabel(userAgent),
      userAgent
    });
  }

  authenticateToken(token: string | null, request?: express.Request) {
    if (!token) {
      return null;
    }

    const row = this.database.prepare(`
      SELECT id, label
      FROM access_devices
      WHERE token_hash = ? AND revoked_at IS NULL
      LIMIT 1
    `).get(hashAccessToken(token)) as { id: string; label: string } | undefined;

    if (!row) {
      return null;
    }

    this.touchDevice(row.id, request);
    return {
      id: row.id,
      label: row.label
    } satisfies AuthenticatedAccessDevice;
  }

  listDevices(
    currentDeviceId: string | null,
    options: { includeRevoked?: boolean } = {}
  ): { devices: AccessDeviceSummary[] } {
    const rows = this.database.prepare(`
      SELECT id, token_hash, label, user_agent, created_at, last_seen_at, last_ip, revoked_at
      FROM access_devices
      ${options.includeRevoked ? "" : "WHERE revoked_at IS NULL"}
      ORDER BY revoked_at IS NULL DESC, last_seen_at DESC, created_at DESC
    `).all() as AccessDeviceRow[];

    return {
      devices: rows.map((row) => mapDeviceRow(row, currentDeviceId))
    };
  }

  updateDeviceLabel(
    deviceId: string,
    label: string,
    currentDeviceId: string | null
  ): UpdateAccessDeviceResponse | null {
    const result = this.database.prepare(`
      UPDATE access_devices
      SET label = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(label, deviceId);

    if (result.changes === 0) {
      return null;
    }

    const row = this.database.prepare(`
      SELECT id, token_hash, label, user_agent, created_at, last_seen_at, last_ip, revoked_at
      FROM access_devices
      WHERE id = ?
      LIMIT 1
    `).get(deviceId) as AccessDeviceRow | undefined;

    return row
      ? {
          device: mapDeviceRow(row, currentDeviceId)
        }
      : null;
  }

  revokeCurrentDevice(currentDeviceId: string | null): RevokeAccessDevicesResponse {
    if (!currentDeviceId) {
      return {
        revokedCount: 0
      };
    }

    const result = this.database.prepare(`
      UPDATE access_devices
      SET revoked_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), currentDeviceId);
    this.pruneRevokedDevices();
    return {
      revokedCount: result.changes
    };
  }

  revokeDevice(deviceId: string, currentDeviceId: string | null): RevokeAccessDevicesResponse {
    if (deviceId === currentDeviceId) {
      return this.revokeCurrentDevice(currentDeviceId);
    }

    const result = this.database.prepare(`
      UPDATE access_devices
      SET revoked_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), deviceId);
    this.pruneRevokedDevices();
    return {
      revokedCount: result.changes
    };
  }

  revokeOtherDevices(
    currentDeviceId: string | null,
    options: { revokeAllWhenNoCurrentDevice?: boolean } = {}
  ): RevokeAccessDevicesResponse {
    if (!currentDeviceId) {
      if (options.revokeAllWhenNoCurrentDevice) {
        const result = this.database.prepare(`
          UPDATE access_devices
          SET revoked_at = ?
          WHERE revoked_at IS NULL
        `).run(new Date().toISOString());
        this.pruneRevokedDevices();
        return {
          revokedCount: result.changes
        };
      }

      return {
        revokedCount: 0
      };
    }

    const result = this.database.prepare(`
      UPDATE access_devices
      SET revoked_at = ?
      WHERE id != ? AND revoked_at IS NULL
    `).run(new Date().toISOString(), currentDeviceId);
    this.pruneRevokedDevices();
    return {
      revokedCount: result.changes
    };
  }

  close() {
    if (this.ownsDatabaseContext) {
      this.databaseContext.close();
    }
  }

  usesDatabaseContext(databaseContext: SqliteDatabaseContext) {
    return this.databaseContext === databaseContext && !databaseContext.isClosed;
  }

  isDeviceActive(deviceId: string | null) {
    if (!deviceId) {
      return false;
    }

    const row = this.database.prepare(`
      SELECT id
      FROM access_devices
      WHERE id = ? AND revoked_at IS NULL
      LIMIT 1
    `).get(deviceId);

    return Boolean(row);
  }

  private touchDevice(deviceId: string, request: express.Request | undefined) {
    const nowMs = Date.now();
    const previousUpdate = this.lastSeenUpdates.get(deviceId) ?? 0;
    if (nowMs - previousUpdate < LAST_SEEN_UPDATE_INTERVAL_MS) {
      return;
    }

    this.lastSeenUpdates.set(deviceId, nowMs);
    this.database.prepare(`
      UPDATE access_devices
      SET last_seen_at = @lastSeenAt, last_ip = @lastIp
      WHERE id = @id AND revoked_at IS NULL
    `).run({
      id: deviceId,
      lastSeenAt: new Date(nowMs).toISOString(),
      lastIp: request ? readRequestIp(request) : null
    });
  }

  private pruneExpiredRecoveryCodes(now: string) {
    this.database.prepare(`
      DELETE FROM access_recovery_codes
      WHERE expires_at < ? OR used_at IS NOT NULL
    `).run(now);
  }

  private pruneRevokedDevices() {
    this.database.prepare(`
      DELETE FROM access_devices
      WHERE id IN (
        SELECT id
        FROM access_devices
        WHERE revoked_at IS NOT NULL
        ORDER BY revoked_at DESC, created_at DESC, id DESC
        LIMIT -1 OFFSET ?
      )
    `).run(MAX_REVOKED_ACCESS_DEVICE_ROWS);
  }
}

export let accessDeviceStore = new AccessDeviceStore();

/**
 * Keeps the process-wide access store aligned with the production SQLite
 * context. ESM imports observe the reassigned live binding, so a daemon that
 * is stopped and started again in the same process cannot retain statements
 * from the previously closed connection.
 */
export function bindProductionAccessDeviceStore(
  databaseContext: SqliteDatabaseContext
) {
  if (!accessDeviceStore.usesDatabaseContext(databaseContext)) {
    accessDeviceStore = new AccessDeviceStore(databaseContext);
  }
  return accessDeviceStore;
}
