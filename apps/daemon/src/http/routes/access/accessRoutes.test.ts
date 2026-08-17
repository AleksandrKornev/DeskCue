import express from "express";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import test from "node:test";

import type {
  AccessDevicesResponse,
  AccessLinkResponse,
  AccessLinkStatusResponse,
  CreateAccessRecoveryCodeResponse,
  PairAccessResponse,
  RevokeAccessDevicesResponse,
  UpdateAccessDeviceResponse
} from "@deskcue/protocol";
import { readRequestIp, setRequestAccessDevice } from "#access/accessDevices";
import { daemonConfig } from "#config/daemonConfig";

import { createDeviceAccessTokenMiddleware } from "./accessControl.ts";
import { canCreateAccessLink, installAccessRoutes } from "./accessRoutes.ts";
import { isHostClientRequest } from "../../hostClient.ts";
import { findLanIPv4Address } from "../../networkHosts.ts";

function localBrowserHeaders() {
  return {
    "sec-fetch-site": "same-origin"
  };
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function withServer<T>(app: express.Express, callback: (baseUrl: string) => Promise<T>) {
  const server = createServer(app);

  return new Promise<T>((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address();
        assert(address && typeof address === "object");
        const result = await callback(`http://127.0.0.1:${address.port}`);
        closeServer(server).then(() => resolve(result), reject);
      } catch (error) {
        closeServer(server).then(() => reject(error), reject);
      }
    });
  });
}

test("access link route returns a ready-to-open web URL for host clients", async () => {
  const app = express();
  installAccessRoutes(app);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/access/link`, {
      headers: localBrowserHeaders()
    });
    const payload = (await response.json()) as AccessLinkResponse;

    assert.equal(response.status, 200);
    assert.equal(Boolean(payload.pairCode), true);
    assert.equal(payload.daemonUrl.includes(":4100"), true);
    assert.equal(payload.webUrl.includes(":4100"), true);
    assert.equal(payload.webUrl.endsWith(`/pair/${payload.pairCode}`), true);
    assert.equal(payload.webUrl.includes("deskcueDaemon="), false);
    assert.equal(payload.webUrl.includes("deskcuePair="), false);
    assert.equal(payload.webUrl.includes("deskcueToken="), false);
  });
});

test("host client detection ignores forged forwarded loopback from LAN clients", () => {
  assert.equal(
    isHostClientRequest({
      headers: {
        "x-forwarded-for": "127.0.0.1"
      },
      ip: "203.0.113.44",
      socket: {
        remoteAddress: "203.0.113.44"
      }
    } as never),
    false
  );
});

test("request IP resolver never trusts forwarded addresses without a trusted-proxy model", () => {
  assert.equal(
    readRequestIp({
      headers: {
        "x-forwarded-for": "203.0.113.44"
      },
      ip: "127.0.0.1",
      socket: {
        remoteAddress: "::ffff:127.0.0.1"
      }
    } as never),
    "::ffff:127.0.0.1"
  );

  assert.equal(
    readRequestIp({
      headers: {
        "x-forwarded-for": "127.0.0.1"
      },
      ip: "203.0.113.44",
      socket: {
        remoteAddress: "203.0.113.44"
      }
    } as never),
    "203.0.113.44"
  );
});

test("host client detection rejects non-local LAN clients", () => {
  assert.equal(
    isHostClientRequest({
      headers: {},
      ip: "203.0.113.44",
      socket: {
        remoteAddress: "203.0.113.44"
      }
    } as never),
    false
  );
});

test("access link creation is allowed for paired non-host clients", () => {
  const request = {
    headers: {},
    ip: "203.0.113.44",
    socket: {
      remoteAddress: "203.0.113.44"
    }
  } as never;

  assert.equal(canCreateAccessLink(request), false);
  setRequestAccessDevice(request, {
    id: "device-1",
    label: "Chrome browser"
  });
  assert.equal(canCreateAccessLink(request), true);
});

test("unpaired access link creation requires an exact local browser origin", () => {
  assert.equal(
    canCreateAccessLink({
      headers: {
        host: "127.0.0.1:4100",
        origin: "http://127.0.0.1:4100"
      },
      socket: {
        remoteAddress: "::ffff:127.0.0.1"
      }
    } as never),
    true
  );
  assert.equal(
    canCreateAccessLink({
      headers: {
        host: "deskcue.example.com",
        origin: "https://deskcue.example.com",
        "x-forwarded-for": "192.168.1.50"
      },
      socket: {
        remoteAddress: "127.0.0.1"
      }
    } as never),
    false
  );
  assert.equal(
    canCreateAccessLink({
      headers: {
        host: "127.0.0.1:4100",
        origin: "http://127.0.0.1:4100",
        "x-forwarded-for": "127.0.0.1"
      },
      socket: {
        remoteAddress: "192.168.1.50"
      }
    } as never),
    false
  );
});

test("host client detection allows the host LAN interface address", (context) => {
  const lanAddress = findLanIPv4Address();
  if (!lanAddress) {
    context.skip("No LAN IPv4 address on this machine");
    return;
  }

  assert.equal(
    isHostClientRequest({
      headers: {},
      ip: lanAddress,
      socket: {
        remoteAddress: `::ffff:${lanAddress}`
      }
    } as never),
    true
  );
});

test("access link route can prefer public host for device links", async () => {
  const previousConfig = {
    bindHost: daemonConfig.bindHost,
    publicHost: daemonConfig.publicHost
  };
  const app = express();
  installAccessRoutes(app);

  try {
    daemonConfig.bindHost = "0.0.0.0";
    daemonConfig.publicHost = "deskcue-lan.local";

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/access/link?target=device`, {
        headers: localBrowserHeaders()
      });
      const payload = (await response.json()) as AccessLinkResponse;

      assert.equal(response.status, 200);
      assert.equal(payload.hostSource, "public_host");
      assert.equal(payload.lanReady, true);
      assert.equal(payload.daemonUrl, "http://deskcue-lan.local:4100");
      assert.equal(payload.webUrl.startsWith("http://deskcue-lan.local:4100/"), true);
    });
  } finally {
    daemonConfig.bindHost = previousConfig.bindHost;
    daemonConfig.publicHost = previousConfig.publicHost;
  }
});

test("access link route keeps Vite web port when requested from the dev dashboard", async () => {
  const previousConfig = {
    bindHost: daemonConfig.bindHost,
    publicHost: daemonConfig.publicHost
  };
  const app = express();
  installAccessRoutes(app);

  try {
    daemonConfig.bindHost = "0.0.0.0";
    daemonConfig.publicHost = "deskcue-lan.local";

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/access/link?target=device`, {
        headers: {
          referer: "http://127.0.0.1:4173/settings",
          "sec-fetch-site": "same-origin"
        }
      });
      const payload = (await response.json()) as AccessLinkResponse;

      assert.equal(response.status, 200);
      assert.equal(payload.hostSource, "public_host");
      assert.equal(payload.daemonUrl, "http://deskcue-lan.local:4100");
      assert.equal(payload.webUrl.startsWith("http://deskcue-lan.local:4173/"), true);
    });
  } finally {
    daemonConfig.bindHost = previousConfig.bindHost;
    daemonConfig.publicHost = previousConfig.publicHost;
  }
});

test("access link route treats URL public host as browser-facing proxy origin", async () => {
  const previousConfig = {
    bindHost: daemonConfig.bindHost,
    publicHost: daemonConfig.publicHost
  };
  const app = express();
  installAccessRoutes(app);

  try {
    daemonConfig.bindHost = "0.0.0.0";
    daemonConfig.publicHost = "https://deskcue.example.com";

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/access/link?target=device`, {
        headers: localBrowserHeaders()
      });
      const payload = (await response.json()) as AccessLinkResponse;

      assert.equal(response.status, 200);
      assert.equal(payload.hostSource, "public_host");
      assert.equal(payload.daemonUrl, "https://deskcue.example.com");
      assert.equal(payload.webUrl, `https://deskcue.example.com/pair/${payload.pairCode}`);
    });
  } finally {
    daemonConfig.bindHost = previousConfig.bindHost;
    daemonConfig.publicHost = previousConfig.publicHost;
  }
});

test("access link route keeps mobile target as a device-link compatibility alias", async () => {
  const previousConfig = {
    bindHost: daemonConfig.bindHost,
    publicHost: daemonConfig.publicHost
  };
  const app = express();
  installAccessRoutes(app);

  try {
    daemonConfig.bindHost = "0.0.0.0";
    daemonConfig.publicHost = "https://deskcue.example.com";

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/access/link?target=mobile`, {
        headers: localBrowserHeaders()
      });
      const payload = (await response.json()) as AccessLinkResponse;

      assert.equal(response.status, 200);
      assert.equal(payload.hostSource, "public_host");
      assert.equal(payload.lanReady, true);
      assert.equal(payload.webUrl, `https://deskcue.example.com/pair/${payload.pairCode}`);
    });
  } finally {
    daemonConfig.bindHost = previousConfig.bindHost;
    daemonConfig.publicHost = previousConfig.publicHost;
  }
});

test("access link route warns when device link cannot be reached through loopback bind", async () => {
  const previousConfig = {
    bindHost: daemonConfig.bindHost,
    publicHost: daemonConfig.publicHost
  };
  const app = express();
  installAccessRoutes(app);

  try {
    daemonConfig.bindHost = "127.0.0.1";
    daemonConfig.publicHost = "deskcue-lan.local";

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/access/link?target=device`, {
        headers: localBrowserHeaders()
      });
      const payload = (await response.json()) as AccessLinkResponse;

      assert.equal(response.status, 200);
      assert.equal(payload.hostSource, "public_host");
      assert.equal(payload.lanReady, false);
      assert.deepEqual(payload.warnings, [
        "DeskCue is bound to loopback; set DESKCUE_BIND_HOST=0.0.0.0 before opening this link from another device"
      ]);
    });
  } finally {
    daemonConfig.bindHost = previousConfig.bindHost;
    daemonConfig.publicHost = previousConfig.publicHost;
  }
});

function readSetCookieHeader(response: Response) {
  return response.headers.get("set-cookie") ?? "";
}

test("pairing route exchanges a one-time code for an access token", async () => {
  const app = express();
  app.use(express.json());
  installAccessRoutes(app);

  await withServer(app, async (baseUrl) => {
    const linkResponse = await fetch(`${baseUrl}/api/access/link`, {
      headers: localBrowserHeaders()
    });
    const link = (await linkResponse.json()) as AccessLinkResponse;
    const pairedResponse = await fetch(`${baseUrl}/api/access/pair`, {
      body: JSON.stringify({
        code: link.pairCode
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
    const replayResponse = await fetch(`${baseUrl}/api/access/pair`, {
      body: JSON.stringify({
        code: link.pairCode
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
    const paired = (await pairedResponse.json()) as PairAccessResponse;

    assert.equal(pairedResponse.status, 200);
    assert.match(readSetCookieHeader(pairedResponse), /deskcue_access=/);
    assert.match(readSetCookieHeader(pairedResponse), /HttpOnly/);
    assert.match(readSetCookieHeader(pairedResponse), /SameSite=Lax/);
    assert.equal(Boolean(paired.accessToken), true);
    assert.equal(Boolean(paired.deviceId), true);
    assert.equal(replayResponse.status, 401);
  });
});

async function pairCookieIncludesSecure(headers: Record<string, string> = {}) {
  const app = express();
  app.use(express.json());
  installAccessRoutes(app);

  return withServer(app, async (baseUrl) => {
    const linkResponse = await fetch(`${baseUrl}/api/access/link`, {
      headers: localBrowserHeaders()
    });
    const link = (await linkResponse.json()) as AccessLinkResponse;
    const pairedResponse = await fetch(`${baseUrl}/api/access/pair`, {
      body: JSON.stringify({
        code: link.pairCode
      }),
      headers: {
        "content-type": "application/json",
        ...headers
      },
      method: "POST"
    });

    assert.equal(pairedResponse.status, 200);
    return /;\s*Secure(?:;|$)/i.test(readSetCookieHeader(pairedResponse));
  });
}

test("pairing cookie secure flag follows request and explicit daemon override", async () => {
  const previousCookieSecure = daemonConfig.cookieSecure;

  try {
    daemonConfig.cookieSecure = "auto";
    assert.equal(await pairCookieIncludesSecure(), false);
    assert.equal(await pairCookieIncludesSecure({ "x-forwarded-proto": "https" }), true);

    daemonConfig.cookieSecure = true;
    assert.equal(await pairCookieIncludesSecure(), true);

    daemonConfig.cookieSecure = false;
    assert.equal(await pairCookieIncludesSecure({ "x-forwarded-proto": "https" }), false);
  } finally {
    daemonConfig.cookieSecure = previousCookieSecure;
  }
});

test("access link status reports when a pairing code is used", async () => {
  const app = express();
  app.use(express.json());
  installAccessRoutes(app);

  await withServer(app, async (baseUrl) => {
    const linkResponse = await fetch(`${baseUrl}/api/access/link`, {
      headers: localBrowserHeaders()
    });
    const link = (await linkResponse.json()) as AccessLinkResponse;
    const activeResponse = await fetch(`${baseUrl}/api/access/link/${encodeURIComponent(link.pairCode)}/status`);
    const active = (await activeResponse.json()) as AccessLinkStatusResponse;

    await fetch(`${baseUrl}/api/access/pair`, {
      body: JSON.stringify({
        code: link.pairCode
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });

    const usedResponse = await fetch(`${baseUrl}/api/access/link/${encodeURIComponent(link.pairCode)}/status`);
    const used = (await usedResponse.json()) as AccessLinkStatusResponse;

    assert.equal(activeResponse.status, 200);
    assert.equal(active.status, "active");
    assert.equal(usedResponse.status, 200);
    assert.equal(used.status, "used");
  });
});

function bearerHeaders(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`
  };
}

async function pairBrowser(baseUrl: string, userAgent = "Chrome Test Browser") {
  const linkResponse = await fetch(`${baseUrl}/api/access/link`, {
    headers: localBrowserHeaders()
  });
  const link = (await linkResponse.json()) as AccessLinkResponse;
  const response = await fetch(`${baseUrl}/api/access/pair`, {
    body: JSON.stringify({
      code: link.pairCode
    }),
    headers: {
      "content-type": "application/json",
      "user-agent": userAgent
    },
    method: "POST"
  });

  assert.equal(response.status, 200);
  return await response.json() as PairAccessResponse;
}

test("access recovery code can be redeemed once for a new device token", async () => {
  const app = express();
  app.use(express.json());
  app.use(createDeviceAccessTokenMiddleware(() => true));
  installAccessRoutes(app);

  await withServer(app, async (baseUrl) => {
    const current = await pairBrowser(baseUrl);
    const createResponse = await fetch(`${baseUrl}/api/access/recovery-codes`, {
      headers: bearerHeaders(current.accessToken),
      method: "POST"
    });
    const created = (await createResponse.json()) as CreateAccessRecoveryCodeResponse;
    const recoverResponse = await fetch(`${baseUrl}/api/access/recover`, {
      body: JSON.stringify({
        code: created.code.toLowerCase().replace(/-/g, " ")
      }),
      headers: {
        "content-type": "application/json",
        "user-agent": "Mobile Recovery Browser"
      },
      method: "POST"
    });
    const recovered = (await recoverResponse.json()) as PairAccessResponse;
    const replayResponse = await fetch(`${baseUrl}/api/access/recover`, {
      body: JSON.stringify({
        code: created.code
      }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });
    const recoveredCheck = await fetch(`${baseUrl}/api/access/devices`, {
      headers: bearerHeaders(recovered.accessToken)
    });
    const recoveredDevices = (await recoveredCheck.json()) as AccessDevicesResponse;

    assert.equal(createResponse.status, 200);
    assert.equal(Boolean(created.code), true);
    assert.equal(Boolean(created.expiresAt), true);
    assert.equal(recoverResponse.status, 200);
    assert.match(readSetCookieHeader(recoverResponse), /deskcue_access=/);
    assert.match(readSetCookieHeader(recoverResponse), /HttpOnly/);
    assert.equal(Boolean(recovered.accessToken), true);
    assert.equal(Boolean(recovered.deviceId), true);
    assert.equal(replayResponse.status, 401);
    assert.equal(recoveredCheck.status, 200);
    assert.equal(recoveredDevices.devices.some((device) => device.id === recovered.deviceId && device.current), true);
  });
});

function lanBearerHeaders(accessToken: string) {
  return {
    ...bearerHeaders(accessToken),
    "x-forwarded-for": "203.0.113.70"
  };
}

test("access devices route lists the current paired device", async () => {
  const previousConfig = {
    authRequired: daemonConfig.authRequired
  };
  const app = express();
  app.use(express.json());
  app.use(createDeviceAccessTokenMiddleware(() => true));
  installAccessRoutes(app);

  try {
    daemonConfig.authRequired = true;

    await withServer(app, async (baseUrl) => {
      const paired = await pairBrowser(baseUrl);
      const response = await fetch(`${baseUrl}/api/access/devices`, {
        headers: lanBearerHeaders(paired.accessToken)
      });
      const payload = (await response.json()) as AccessDevicesResponse;

      assert.equal(response.status, 200);
      assert.deepEqual(payload.currentAccess, {
        authRequired: true,
        credentialPresented: true,
        deviceId: paired.deviceId,
        trustedHost: false
      });
      assert.equal(payload.devices.some((device) => device.id === paired.deviceId && device.current), true);
    });
  } finally {
    daemonConfig.authRequired = previousConfig.authRequired;
  }
});

test("access devices route reports trusted host access without a device token", async () => {
  const previousConfig = {
    authRequired: daemonConfig.authRequired
  };
  const app = express();
  app.use(express.json());
  installAccessRoutes(app);

  try {
    daemonConfig.authRequired = true;

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/access/devices`, {
        headers: {
          origin: baseUrl
        }
      });
      const payload = (await response.json()) as AccessDevicesResponse;

      assert.equal(response.status, 200);
      assert.deepEqual(payload.currentAccess, {
        authRequired: true,
        credentialPresented: false,
        deviceId: null,
        trustedHost: true
      });
    });
  } finally {
    daemonConfig.authRequired = previousConfig.authRequired;
  }
});

test("access devices route excludes revoked tokens by default", async () => {
  const app = express();
  app.use(express.json());
  app.use(createDeviceAccessTokenMiddleware(() => true));
  installAccessRoutes(app);

  await withServer(app, async (baseUrl) => {
    const current = await pairBrowser(baseUrl);
    const revoked = await pairBrowser(baseUrl);
    const revokeResponse = await fetch(`${baseUrl}/api/access/devices/${revoked.deviceId}`, {
      headers: bearerHeaders(current.accessToken),
      method: "DELETE"
    });
    const defaultResponse = await fetch(`${baseUrl}/api/access/devices`, {
      headers: bearerHeaders(current.accessToken)
    });
    const defaultPayload = (await defaultResponse.json()) as AccessDevicesResponse;
    const diagnosticResponse = await fetch(`${baseUrl}/api/access/devices?includeRevoked=true`, {
      headers: bearerHeaders(current.accessToken)
    });
    const diagnosticPayload = (await diagnosticResponse.json()) as AccessDevicesResponse;

    assert.equal(revokeResponse.status, 200);
    assert.equal(defaultResponse.status, 200);
    assert.equal(defaultPayload.devices.some((device) => device.id === revoked.deviceId), false);
    assert.equal(diagnosticResponse.status, 200);
    assert.equal(
      diagnosticPayload.devices.some(
        (device) => device.id === revoked.deviceId && Boolean(device.revokedAt)
      ),
      true
    );
  });
});

test("access device route renames a paired token", async () => {
  const app = express();
  app.use(express.json());
  app.use(createDeviceAccessTokenMiddleware(() => true));
  installAccessRoutes(app);

  await withServer(app, async (baseUrl) => {
    const paired = await pairBrowser(baseUrl);
    const response = await fetch(`${baseUrl}/api/access/devices/${paired.deviceId}`, {
      body: JSON.stringify({
        label: "Phone by the desk"
      }),
      headers: {
        ...bearerHeaders(paired.accessToken),
        "content-type": "application/json"
      },
      method: "PATCH"
    });
    const payload = (await response.json()) as UpdateAccessDeviceResponse;
    const listResponse = await fetch(`${baseUrl}/api/access/devices`, {
      headers: bearerHeaders(paired.accessToken)
    });
    const listPayload = (await listResponse.json()) as AccessDevicesResponse;

    assert.equal(response.status, 200);
    assert.equal(payload.device.id, paired.deviceId);
    assert.equal(payload.device.label, "Phone by the desk");
    assert.equal(listPayload.devices.find((device) => device.id === paired.deviceId)?.label, "Phone by the desk");
  });
});

test("pairing the same browser signature keeps independent tokens active", async () => {
  const app = express();
  app.use(express.json());
  app.use(createDeviceAccessTokenMiddleware(() => true));
  installAccessRoutes(app);

  await withServer(app, async (baseUrl) => {
    const first = await pairBrowser(baseUrl, "Chrome Same Machine Test");
    const second = await pairBrowser(baseUrl, "Chrome Same Machine Test");
    const firstCheck = await fetch(`${baseUrl}/api/access/devices`, {
      headers: bearerHeaders(first.accessToken)
    });
    const secondCheck = await fetch(`${baseUrl}/api/access/devices`, {
      headers: bearerHeaders(second.accessToken)
    });
    const payload = (await secondCheck.json()) as AccessDevicesResponse;

    assert.equal(firstCheck.status, 200);
    assert.equal(secondCheck.status, 200);
    assert.equal(
      payload.devices.filter(
        (device) =>
          [first.deviceId, second.deviceId].includes(device.id) &&
          device.label === "Chrome browser" &&
          device.userAgent === "Chrome Same Machine Test" &&
          !device.revokedAt
      ).length,
      2
    );
  });
});

test("access reset compatibility route revokes other paired devices", async () => {
  const app = express();
  app.use(express.json());
  app.use(createDeviceAccessTokenMiddleware(() => true));
  installAccessRoutes(app);

  await withServer(app, async (baseUrl) => {
    const current = await pairBrowser(baseUrl);
    const other = await pairBrowser(baseUrl);
    const response = await fetch(`${baseUrl}/api/access/reset`, {
      headers: bearerHeaders(current.accessToken),
      method: "POST"
    });
    const payload = (await response.json()) as RevokeAccessDevicesResponse;
    const currentCheck = await fetch(`${baseUrl}/api/access/devices`, {
      headers: lanBearerHeaders(current.accessToken)
    });
    const revokedCheck = await fetch(`${baseUrl}/api/access/devices`, {
      headers: lanBearerHeaders(other.accessToken)
    });

    assert.equal(response.status, 200);
    assert.equal(payload.revokedCount >= 1, true);
    assert.equal(currentCheck.status, 200);
    assert.equal(revokedCheck.status, 401);
  });
});

test("trusted host revoke-others revokes all device tokens without a current device", async () => {
  const previousConfig = {
    authRequired: daemonConfig.authRequired
  };
  const app = express();
  app.use(express.json());
  app.use(createDeviceAccessTokenMiddleware(() => true));
  installAccessRoutes(app);

  try {
    daemonConfig.authRequired = true;

    await withServer(app, async (baseUrl) => {
      const first = await pairBrowser(baseUrl);
      const second = await pairBrowser(baseUrl);
      const response = await fetch(`${baseUrl}/api/access/devices/revoke-others`, {
        headers: {
          origin: baseUrl
        },
        method: "POST"
      });
      const payload = (await response.json()) as RevokeAccessDevicesResponse;
      const firstCheck = await fetch(`${baseUrl}/api/access/devices`, {
        headers: lanBearerHeaders(first.accessToken)
      });
      const secondCheck = await fetch(`${baseUrl}/api/access/devices`, {
        headers: lanBearerHeaders(second.accessToken)
      });

      assert.equal(response.status, 200);
      assert.equal(payload.revokedCount >= 2, true);
      assert.equal(firstCheck.status, 401);
      assert.equal(secondCheck.status, 401);
    });
  } finally {
    daemonConfig.authRequired = previousConfig.authRequired;
  }
});

test("current access device revoke disconnects only this browser token", async () => {
  const app = express();
  app.use(express.json());
  app.use(createDeviceAccessTokenMiddleware(() => true));
  installAccessRoutes(app);

  await withServer(app, async (baseUrl) => {
    const current = await pairBrowser(baseUrl);
    const other = await pairBrowser(baseUrl);
    const response = await fetch(`${baseUrl}/api/access/devices/current`, {
      headers: bearerHeaders(current.accessToken),
      method: "DELETE"
    });
    const payload = (await response.json()) as RevokeAccessDevicesResponse;
    const revokedCheck = await fetch(`${baseUrl}/api/access/devices`, {
      headers: lanBearerHeaders(current.accessToken)
    });
    const otherCheck = await fetch(`${baseUrl}/api/access/devices`, {
      headers: lanBearerHeaders(other.accessToken)
    });

    assert.equal(response.status, 200);
    assert.equal(payload.revokedCount, 1);
    assert.equal(revokedCheck.status, 401);
    assert.equal(otherCheck.status, 200);
  });
});
