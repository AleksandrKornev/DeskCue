import { getConnectionConfig } from "@api/connection/configStorage";

import type {
  DeskCueRuntime,
  DeskCueRuntimeFeatures
} from "./types";

const LOCAL_FEATURES: DeskCueRuntimeFeatures = {
  accessSettings: true,
  cloudConnection: true,
  daemonLogs: true,
  externalHostProcessControls: true,
  files: true,
  gitRefresh: true,
  localLlmChats: true,
  localRuntimes: true,
  manualRunner: true,
  notifications: true,
  preview: true,
  previewControl: true,
  realtime: true,
  sessionCommands: true,
  workspaceManagement: true
};

const CLOUD_MACHINE_FEATURES: DeskCueRuntimeFeatures = {
  accessSettings: false,
  cloudConnection: false,
  daemonLogs: false,
  externalHostProcessControls: false,
  files: false,
  gitRefresh: false,
  localLlmChats: false,
  localRuntimes: false,
  manualRunner: false,
  notifications: false,
  preview: false,
  previewControl: false,
  realtime: false,
  sessionCommands: false,
  workspaceManagement: false
};

const CLOUD_MACHINE_PATH_PATTERN = /^\/machines\/([^/]+)\/deskcue(?:\/|$)/;
const MACHINE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

let currentRuntime: DeskCueRuntime | null = null;
let providerRuntime: { owner: symbol; runtime: DeskCueRuntime } | null = null;

function normalizeAppPath(path: string) {
  if (!path || path === "/") {
    return "/";
  }
  return `/${path.replace(/^\/+|\/+$/g, "")}`;
}

function normalizeRouterBasename(path: string) {
  const normalized = normalizeAppPath(path);
  return normalized === "/" ? normalized : normalized.replace(/\/$/, "");
}

export function joinRouterPath(basename: string, path: string) {
  const normalizedPath = normalizeAppPath(path);
  const normalizedBasename = normalizeRouterBasename(basename);
  return normalizedBasename === "/"
    ? normalizedPath
    : `${normalizedBasename}${normalizedPath === "/" ? "/" : normalizedPath}`;
}

export function stripRouterBasename(basename: string, pathname: string) {
  const normalizedBasename = normalizeRouterBasename(basename);
  const normalizedPathname = normalizeAppPath(pathname);
  if (normalizedBasename === "/") {
    return normalizedPathname;
  }
  if (normalizedPathname === normalizedBasename) {
    return "/";
  }
  if (!normalizedPathname.startsWith(`${normalizedBasename}/`)) {
    return normalizedPathname;
  }
  return normalizeAppPath(normalizedPathname.slice(normalizedBasename.length));
}

export function buildCloudLoginUrl(location: Location) {
  const from = `${location.pathname}${location.search}${location.hash}`;
  return `/login?from=${encodeURIComponent(from)}`;
}

export function initializeDeskCueRuntime(runtime: DeskCueRuntime) {
  currentRuntime = runtime;
  return runtime;
}

export function activateDeskCueRuntime(owner: symbol, runtime: DeskCueRuntime) {
  if (providerRuntime && providerRuntime.owner !== owner) {
    throw new Error("DeskCue supports one mounted runtime provider per page.");
  }
  providerRuntime = { owner, runtime };
}

export function releaseDeskCueRuntime(owner: symbol) {
  if (providerRuntime?.owner === owner) {
    providerRuntime = null;
  }
}

export function createLocalDeskCueRuntime(): DeskCueRuntime {
  return {
    buildAppPath: normalizeAppPath,
    buildHttpUrl(path) {
      if (/^https?:\/\//i.test(path)) {
        return path;
      }
      const { daemonUrl } = getConnectionConfig();
      return daemonUrl ? `${daemonUrl}${path}` : path;
    },
    buildWebSocketUrl(path) {
      const { accessToken, daemonUrl } = getConnectionConfig();
      const url = new URL(path, daemonUrl || window.location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      if (accessToken) {
        url.searchParams.set("token", accessToken);
      }
      return url.toString();
    },
    features: LOCAL_FEATURES,
    getAuthorizationToken: () => getConnectionConfig().accessToken,
    getCacheScope() {
      const { daemonUrl, deviceId } = getConnectionConfig();
      return `local:${daemonUrl || "same-origin"}:${deviceId ?? "host"}`;
    },
    getRealtimeScope() {
      const { accessToken, daemonUrl, deviceId } = getConnectionConfig();
      if (accessToken) {
        return null;
      }
      return `${daemonUrl || window.location.origin}|${
        deviceId ? `device:${deviceId}` : "anonymous"
      }`;
    },
    mode: "local",
    readAppPath: normalizeAppPath,
    routerBasename: "/"
  };
}

export function getDeskCueRuntime() {
  currentRuntime ??= createLocalDeskCueRuntime();
  return providerRuntime?.runtime ?? currentRuntime;
}

export function createCloudMachineDeskCueRuntime(location: Location): DeskCueRuntime {
  const match = CLOUD_MACHINE_PATH_PATTERN.exec(location.pathname);
  if (!match) {
    throw new Error("DeskCue Cloud machine route is invalid.");
  }

  let machineId: string;
  try {
    machineId = decodeURIComponent(match[1]);
  } catch {
    throw new Error("DeskCue Cloud machine identifier is invalid.");
  }
  if (!MACHINE_ID_PATTERN.test(machineId)) {
    throw new Error("DeskCue Cloud machine identifier is invalid.");
  }

  const encodedMachineId = encodeURIComponent(machineId);
  const routerBasename = `/machines/${encodedMachineId}/deskcue`;
  const transportBase = `/v1/machines/${encodedMachineId}/deskcue`;

  return {
    buildAppPath: (path) => joinRouterPath(routerBasename, path),
    buildHttpUrl(path) {
      if (/^https?:\/\//i.test(path)) {
        const url = new URL(path);
        if (url.origin !== location.origin || !url.pathname.startsWith(`${transportBase}/`)) {
          throw new Error("DeskCue Cloud rejected an out-of-scope resource URL.");
        }
        return url.toString();
      }
      if (!path.startsWith("/api/")) {
        throw new Error("DeskCue Cloud rejected an unsupported API path.");
      }
      return `${transportBase}${path}`;
    },
    buildWebSocketUrl(path) {
      const input = new URL(path, location.origin);
      if (input.pathname !== "/ws") {
        throw new Error("DeskCue Cloud rejected an unsupported realtime path.");
      }
      const url = new URL(`${transportBase}/ws`, location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.search = input.search;
      return url.toString();
    },
    features: CLOUD_MACHINE_FEATURES,
    getAuthorizationToken: () => null,
    getCacheScope: () => null,
    getRealtimeScope: () => `cloud-machine:${machineId}`,
    mode: "cloud-machine",
    onUnauthorized: () => window.location.replace(buildCloudLoginUrl(window.location)),
    readAppPath: (pathname) => stripRouterBasename(routerBasename, pathname),
    routerBasename
  };
}

export function readCloudMutationCsrfToken(
  method: string | undefined,
  requestUrl: string,
  location: Location,
  cookieHeader = document.cookie
) {
  if (!method || !["delete", "patch", "post", "put"].includes(method.toLowerCase())) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(requestUrl, location.origin);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) {
    return null;
  }

  const cookieParts = cookieHeader.split(";").map((part) => part.trim());
  for (const cookieName of ["__Host-deskcue_csrf", "deskcue_dev_csrf"]) {
    const prefix = `${cookieName}=`;
    const csrfCookie = cookieParts.find((part) => part.startsWith(prefix));
    if (!csrfCookie) continue;

    const encodedValue = csrfCookie.slice(prefix.length);
    try {
      return decodeURIComponent(encodedValue) || null;
    } catch {
      return null;
    }
  }

  return null;
}

export function resetDeskCueRuntimeForTests() {
  currentRuntime = null;
  providerRuntime = null;
}
