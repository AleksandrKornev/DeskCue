type PreviewBootstrapGlobals = typeof globalThis & {
  __deskcuePreviewDocumentUrl?: string;
  __deskcuePreviewInteractions?: boolean;
  __deskcuePreviewRoute?: (value: string | URL) => string | URL;
  __deskcuePreviewShim?: string;
};

type RoutedPreviewBootstrapOptions = {
  basePath: string;
  documentUrl: string;
  hostRouted: boolean;
  localOrigin: string;
};

type UrlPropertyConstructor = {
  prototype: object;
};

function installOpaquePreviewStorageShim() {
  const installStorage = (property: "localStorage" | "sessionStorage") => {
    try {
      if (globalThis[property]) return;
    } catch {
      // Sandboxed documents use an opaque origin and throw on storage access.
    }
    const values = new Map<string, string>();
    const storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(String(key)) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(String(key)),
      setItem: (key: string, value: string) => values.set(String(key), String(value))
    };
    Object.defineProperty(globalThis, property, {
      configurable: true,
      value: storage
    });
  };

  installStorage("localStorage");
  installStorage("sessionStorage");

  if (typeof document === "undefined") return;
  try {
    void document.cookie;
    return;
  } catch {
    // Keep preview-app cookies isolated in memory instead of exposing DeskCue cookies.
  }
  const cookies = new Map<string, string>();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; "),
    set: (value: string) => {
      const pair = String(value).split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) return;
      cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  });
}

function installBasicPreviewNavigationShim(basePath: string) {
  const globals = globalThis as PreviewBootstrapGlobals;
  if (globals.__deskcuePreviewShim === basePath) return;
  globals.__deskcuePreviewShim = basePath;

  const route = (value: string | URL) => {
    try {
      const url = new URL(value, location.href);
      if (
        url.host === location.host &&
        !url.pathname.startsWith(`${basePath}/`) &&
        !url.pathname.startsWith("/api/preview/")
      ) {
        url.pathname = `${basePath}${url.pathname.startsWith("/") ? url.pathname : `/${url.pathname}`}`;
      }
      return url.href;
    } catch {
      return value;
    }
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    typeof input === "string" || input instanceof URL
      ? originalFetch(route(input), init)
      : originalFetch(new Request(route(input.url), input), init);

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = class extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(route(url), protocols);
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(this: XMLHttpRequest, method, url, ...args) {
    Reflect.apply(originalOpen, this, [method, route(url), ...args]);
  } as typeof XMLHttpRequest.prototype.open;

  if (typeof history !== "undefined") {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function pushState(this: History, data, unused, url) {
      Reflect.apply(originalPushState, this, [
        data,
        unused,
        url === null || url === undefined ? url : route(url)
      ]);
    };
    history.replaceState = function replaceState(this: History, data, unused, url) {
      Reflect.apply(originalReplaceState, this, [
        data,
        unused,
        url === null || url === undefined ? url : route(url)
      ]);
    };
  }
}

function installRoutedPreviewNavigationShim(options: RoutedPreviewBootstrapOptions) {
  const globals = globalThis as PreviewBootstrapGlobals;
  const { basePath, documentUrl, hostRouted, localOrigin } = options;
  if (globals.__deskcuePreviewShim === basePath) return;
  globals.__deskcuePreviewShim = basePath;

  const egressMarker = "/__deskcue_egress__/";
  const localUrl = new URL(localOrigin);
  const escapeInvalidPercentSequences = (value: string) =>
    value.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");

  const readDocumentUrl = () => {
    try {
      const ticketIndex = basePath.indexOf("/__deskcue_ticket__/");
      const ownerPath = ticketIndex < 0 ? basePath : basePath.slice(0, ticketIndex);
      const currentPath = location.pathname;
      let upstreamPath: string;
      if (currentPath === ownerPath || currentPath === `${ownerPath}/`) upstreamPath = "/";
      else if (currentPath === basePath || currentPath === `${basePath}/`) upstreamPath = "/";
      else if (currentPath.startsWith(`${basePath}/`)) upstreamPath = currentPath.slice(basePath.length);
      else if (currentPath.startsWith(`${ownerPath}/`)) upstreamPath = currentPath.slice(ownerPath.length);
      else return documentUrl;

      if (upstreamPath.startsWith(egressMarker)) {
        const encodedTarget = upstreamPath.slice(egressMarker.length);
        const separatorIndex = encodedTarget.indexOf("/");
        if (separatorIndex < 0) return documentUrl;
        const encodedOrigin = encodedTarget.slice(0, separatorIndex)
          .replaceAll("-", "+")
          .replaceAll("_", "/");
        const paddedOrigin = encodedOrigin + "=".repeat((4 - encodedOrigin.length % 4) % 4);
        return new URL(
          encodedTarget.slice(separatorIndex) + location.search,
          atob(paddedOrigin)
        ).href;
      }
      return new URL(upstreamPath + location.search, localOrigin).href;
    } catch {
      return documentUrl;
    }
  };

  const stableDocumentUrl = readDocumentUrl();
  const isLoopback = (hostname: string) =>
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const effectivePort = (url: URL) =>
    url.port || (url.protocol === "https:" || url.protocol === "wss:" ? "443" : "80");
  const isLocalTarget = (url: URL) =>
    url.origin === localOrigin ||
    (isLoopback(url.hostname) &&
      isLoopback(localUrl.hostname) &&
      effectivePort(url) === effectivePort(localUrl));
  const encodeOrigin = (value: string) => btoa(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  const buildEgressPath = (url: URL) =>
    `${basePath}${egressMarker}${encodeOrigin(url.origin)}${url.pathname}${url.search}${url.hash}`;
  const route = (value: string | URL) => {
    try {
      const normalizedValue = typeof value === "string"
        ? escapeInvalidPercentSequences(value)
        : value;
      const url = new URL(normalizedValue, stableDocumentUrl);
      if (!/^(https?|wss?):$/.test(url.protocol)) return value;
      if (
        url.host === location.host &&
        (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
      ) {
        return url.href;
      }

      let routedPath: string;
      if (isLocalTarget(url) || url.host === location.host) {
        routedPath = `${basePath}${url.pathname}${url.search}${url.hash}`;
      } else if (hostRouted) {
        routedPath = buildEgressPath(url);
      } else {
        return url.href;
      }

      if (url.protocol === "ws:" || url.protocol === "wss:") {
        const websocketUrl = new URL(routedPath, location.href);
        websocketUrl.protocol = location.protocol === "https:" ? "wss:" : "ws:";
        return websocketUrl.href;
      }
      return new URL(routedPath, location.href).href;
    } catch {
      return value;
    }
  };
  const routeSrcSet = (value: string) => String(value)
    .split(",")
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      parts[0] = String(route(parts[0]));
      return parts.join(" ");
    })
    .join(", ");
  const routeViteHmrPath = (value: unknown) => {
    if (
      typeof value !== "string" ||
      !value.startsWith("/") ||
      value.startsWith("//") ||
      value.startsWith(`${basePath}/`) ||
      value.startsWith("/api/preview/")
    ) {
      return value;
    }
    return `${basePath}${value}`;
  };
  const routeViteHmrMessage = (value: unknown) => {
    if (typeof value !== "string") return value;
    try {
      const payload: unknown = JSON.parse(value);
      if (!payload || typeof payload !== "object") return value;
      const record = payload as Record<string, unknown>;
      if (record.type !== "update" || !Array.isArray(record.updates)) return value;

      let changed = false;
      const updates = (record.updates as unknown[]).map((update): unknown => {
        if (!update || typeof update !== "object") return update;
        const current = update as Record<string, unknown>;
        if (current.type !== "js-update" && current.type !== "css-update") return update;
        const path = routeViteHmrPath(current.path);
        const acceptedPath = routeViteHmrPath(current.acceptedPath);
        if (path === current.path && acceptedPath === current.acceptedPath) return update;
        changed = true;
        return { ...current, path, acceptedPath };
      });
      return changed ? JSON.stringify({ ...record, updates }) : value;
    } catch {
      return value;
    }
  };

  globals.__deskcuePreviewRoute = route;
  globals.__deskcuePreviewDocumentUrl = stableDocumentUrl;

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    typeof input === "string" || input instanceof URL
      ? originalFetch(route(input), init)
      : originalFetch(new Request(route(input.url), input), init);

  const OriginalWebSocket = window.WebSocket;
  const routedMessageEvents = new WeakSet<MessageEvent>();
  window.WebSocket = class extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(route(url), protocols);
      if (typeof this.addEventListener !== "function") return;
      this.addEventListener("message", (event) => {
        if (routedMessageEvents.has(event)) return;
        const data = routeViteHmrMessage(event.data);
        if (data === event.data) return;
        event.stopImmediatePropagation();
        const routedEvent = new MessageEvent("message", {
          data,
          lastEventId: event.lastEventId,
          origin: event.origin,
          ports: [...event.ports],
          source: event.source
        });
        routedMessageEvents.add(routedEvent);
        this.dispatchEvent(routedEvent);
      });
    }
  };

  const OriginalEventSource = window.EventSource;
  if (OriginalEventSource) {
    window.EventSource = class extends OriginalEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(route(url), eventSourceInitDict);
      }
    };
  }

  const OriginalWorker = window.Worker;
  if (OriginalWorker) {
    window.Worker = class extends OriginalWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(route(scriptURL), options);
      }
    };
  }

  const OriginalSharedWorker = window.SharedWorker;
  if (OriginalSharedWorker) {
    window.SharedWorker = class extends OriginalSharedWorker {
      constructor(scriptURL: string | URL, options?: string | WorkerOptions) {
        super(route(scriptURL), options);
      }
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(this: XMLHttpRequest, method, url, ...args) {
    Reflect.apply(originalOpen, this, [method, route(url), ...args]);
  } as typeof XMLHttpRequest.prototype.open;

  if (typeof history !== "undefined") {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function pushState(this: History, data, unused, url) {
      Reflect.apply(originalPushState, this, [
        data,
        unused,
        url === null || url === undefined ? url : route(url)
      ]);
    };
    history.replaceState = function replaceState(this: History, data, unused, url) {
      Reflect.apply(originalReplaceState, this, [
        data,
        unused,
        url === null || url === undefined ? url : route(url)
      ]);
    };
  }

  const originalSendBeacon = navigator.sendBeacon?.bind(navigator);
  if (originalSendBeacon) {
    navigator.sendBeacon = (url, data) => originalSendBeacon(route(url), data);
  }

  const patchUrlProperty = (
    Constructor: UrlPropertyConstructor | null,
    property: string,
    rewrite: (value: string) => string | URL
  ) => {
    if (!Constructor) return;
    const descriptor = Object.getOwnPropertyDescriptor(Constructor.prototype, property);
    if (!descriptor?.set) return;
    Object.defineProperty(Constructor.prototype, property, {
      ...descriptor,
      set(value: string) {
        descriptor.set?.call(this, rewrite(value));
      }
    });
  };

  patchUrlProperty(
    typeof HTMLScriptElement === "undefined" ? null : HTMLScriptElement,
    "src",
    route
  );
  patchUrlProperty(
    typeof HTMLLinkElement === "undefined" ? null : HTMLLinkElement,
    "href",
    route
  );
  patchUrlProperty(
    typeof HTMLImageElement === "undefined" ? null : HTMLImageElement,
    "src",
    route
  );
  patchUrlProperty(
    typeof HTMLImageElement === "undefined" ? null : HTMLImageElement,
    "srcset",
    routeSrcSet
  );
  patchUrlProperty(
    typeof HTMLSourceElement === "undefined" ? null : HTMLSourceElement,
    "src",
    route
  );
  patchUrlProperty(
    typeof HTMLSourceElement === "undefined" ? null : HTMLSourceElement,
    "srcset",
    routeSrcSet
  );

  if (typeof Element !== "undefined") {
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function setAttribute(name, value) {
      const normalizedName = String(name).toLowerCase();
      const tagName = this.tagName;
      const routedValue =
        (normalizedName === "src" && ["SCRIPT", "IMG", "SOURCE"].includes(tagName)) ||
        (normalizedName === "href" && tagName === "LINK")
          ? route(value)
          : normalizedName === "srcset" && ["IMG", "SOURCE"].includes(tagName)
            ? routeSrcSet(value)
            : value;
      return originalSetAttribute.call(this, name, String(routedValue));
    };
  }
}

function installPreviewNavigationInteractions() {
  const globals = globalThis as PreviewBootstrapGlobals;
  if (globals.__deskcuePreviewInteractions) return;
  globals.__deskcuePreviewInteractions = true;

  const route = globals.__deskcuePreviewRoute;
  const documentUrl = globals.__deskcuePreviewDocumentUrl;
  if (!route || !documentUrl || typeof document === "undefined") return;

  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#")) return;

    const routedUrl = String(route(href));
    let nativeUrl: string;
    try {
      nativeUrl = new URL(href, location.href).href;
    } catch {
      nativeUrl = href;
    }
    if (routedUrl === nativeUrl) return;
    event.preventDefault();
    location.assign(routedUrl);
  }, true);

  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement | null;
    if (form?.tagName !== "FORM") return;
    form.action = String(route(form.getAttribute("action") || documentUrl));
  }, true);
}

function serializeBootstrapCall<T>(installer: (options: T) => void, options: T) {
  // The tsx development loader annotates nested functions with a scoped
  // `__name` helper. Production TypeScript output does not need it, but keeping
  // this no-op definition makes Function#toString deterministic in both paths.
  return `(()=>{const __name=(value)=>value;(${installer.toString()})(${JSON.stringify(options)});})();`;
}

export function createPreviewNavigationBootstrap(
  basePath: string,
  options: {
    localOrigin?: string;
    networkMode?: "deskcue-host" | "device-direct";
    upstreamUrl?: URL;
  }
) {
  const storage = serializeBootstrapCall(installOpaquePreviewStorageShim, undefined);
  const navigation = options.localOrigin && options.upstreamUrl
    ? serializeBootstrapCall(installRoutedPreviewNavigationShim, {
      basePath,
      documentUrl: options.upstreamUrl.href,
      hostRouted: options.networkMode === "deskcue-host",
      localOrigin: options.localOrigin
    })
    : serializeBootstrapCall(installBasicPreviewNavigationShim, basePath);
  return `${storage}\n${navigation}\n${serializeBootstrapCall(installPreviewNavigationInteractions, undefined)}\n`;
}
