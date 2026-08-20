import express from "express";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { WebSocket, WebSocketServer } from "ws";

import {
  buildPreviewEgressPath,
  resolvePreviewEgressTarget
} from "./egress/previewEgressTarget.ts";
import type { PreviewEgressResolver } from "./egress/previewEgressTarget.ts";
import { discoverPreviewCandidates, probePreviewPort } from "./previewCandidateDiscovery.ts";
import {
  createPreviewJavaScriptBootstrap,
  MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES,
  rewritePreviewJavaScriptAssetLiterals,
  rewritePreviewContent
} from "./previewContentRewrite.ts";
import { PreviewProxyController } from "./previewProxy.ts";
import { buildPreviewRequestHeaders } from "./previewProxyHeaders.ts";
import { PREVIEW_PROXY_LIMITS } from "./previewProxyLimits.ts";
import { resolveLoopbackPreviewTarget } from "./previewTargetResolver.ts";

test("derives preview targets only from an active bounded port", () => {
  assert.deepEqual(resolveLoopbackPreviewTarget({
    active: true,
    networkMode: "device-direct",
    port: 5173,
    targetUrl: "http://attacker.invalid:5173"
  }), {
    networkMode: "device-direct",
    origin: "http://localhost:5173",
    port: 5173
  });
  assert.equal(resolveLoopbackPreviewTarget({ active: false, networkMode: "device-direct", port: 5173, targetUrl: null }), null);
  assert.equal(resolveLoopbackPreviewTarget({ active: true, networkMode: "device-direct", port: 0, targetUrl: null }), null);
  assert.equal(resolveLoopbackPreviewTarget({ active: true, networkMode: "device-direct", port: 65_536, targetUrl: null }), null);
});

test("discovers a preview app bound only to the IPv6 loopback address", async () => {
  const server = createServer((_request, response) => response.end());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "::1", resolve);
  });

  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    assert.equal(await probePreviewPort(address.port), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("discovers common and configured preview ports with bounded unique results", async () => {
  const probed: number[] = [];
  assert.deepEqual(await discoverPreviewCandidates({
    configuredPort: 9000,
    excludedPort: 4100,
    ports: [3000, 4100, 9000, 8080],
    probe: async (port) => {
      probed.push(port);
      return port === 8080 || port === 9000;
    }
  }), [
    { configured: true, port: 9000 },
    { configured: false, port: 8080 }
  ]);
  assert.deepEqual([...probed].sort((left, right) => left - right), [3000, 8080, 9000]);
});

test("does not forward browser fetch metadata to the local preview server", () => {
  const headers = buildPreviewRequestHeaders({
    accept: "*/*",
    origin: "null",
    referer: "http://deskcue.test/preview",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "cross-site"
  }, new URL("http://127.0.0.1:3000/_next/static/chunks/app.js"));

  assert.equal(headers.accept, "*/*");
  assert.equal(headers.origin, undefined);
  assert.equal(headers.referer, "http://127.0.0.1:3000/_next/static/chunks/app.js");
  assert.equal(headers["sec-fetch-dest"], undefined);
  assert.equal(headers["sec-fetch-mode"], undefined);
  assert.equal(headers["sec-fetch-site"], undefined);
});

test("routes static resources and navigation through the credential resource path", () => {
  const basePath = "/api/preview/sessions/session-1/__deskcue_ticket__/resource-token";
  const html = rewritePreviewContent(
    Buffer.from([
      "<html><head>",
      '<link rel="stylesheet" href="/_next/static/app.css">',
      '<script src="/_next/static/app.js"></script>',
      '<link rel="canonical" href="/canonical">',
      "</head><body>",
      '<a href="/docs">Docs</a>',
      '<form action="/submit"></form>',
      '<img src="icons/logo.svg">',
      '<img src="http://127.0.0.1:3000/absolute.png">',
      '<img src="https://cdn.example.test/external.png">',
      "</body></html>"
    ].join("")),
    "text/html; charset=utf-8",
    basePath,
    {
      localOrigin: "http://127.0.0.1:3000",
      networkMode: "device-direct",
      upstreamUrl: new URL("http://127.0.0.1:3000/")
    }
  ).toString();

  assert.match(html, new RegExp(`href="${basePath}/_next/static/app\\.css"`));
  assert.match(html, new RegExp(`src="${basePath}/_next/static/app\\.js"`));
  assert.match(html, /href="\/canonical"/);
  assert.match(html, /href="\/docs"/);
  assert.match(html, /action="\/submit"/);
  assert.match(html, new RegExp(`src="${basePath}/icons/logo\\.svg"`));
  assert.match(html, new RegExp(`src="${basePath}/absolute\\.png"`));
  assert.match(html, /src="https:\/\/cdn\.example\.test\/external\.png"/);
  assert.doesNotMatch(html, /<base\s/i);
  assert.doesNotMatch(html, /__deskcuePreviewShim/);

  const css = rewritePreviewContent(
    Buffer.from([
      "@font-face{src:url('/fonts/app.woff2')}",
      ".external{background:url(https://cdn.example.test/bg.png)}"
    ].join("")),
    "text/css; charset=utf-8",
    basePath,
    {
      localOrigin: "http://127.0.0.1:3000",
      networkMode: "device-direct",
      upstreamUrl: new URL("http://127.0.0.1:3000/styles/app.css")
    }
  ).toString();
  assert.match(css, new RegExp(`${basePath}/fonts/app\\.woff2`));
  assert.match(css, /https:\/\/cdn\.example\.test\/bg\.png/);
});

test("rewrites escaped Next Flight resource URLs without inserting a hydration-visible head script", () => {
  const basePath = "/api/preview/sessions/session-1/__deskcue_ticket__/resource-token";
  const flight = [
    '1:HL["/_next/static/css/app.css","style"]',
    '2:["$","link",null,{"rel":"icon","href":"/favicon.svg"}]',
    '3:["$","a",null,{"href":"/privacy","children":"Privacy"}]'
  ].join("\n");
  const splitAt = flight.indexOf("favicon") + 3;
  const flightScripts = [flight.slice(0, splitAt), flight.slice(splitAt)]
    .map((chunk) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`)
    .join("");
  const source = [
    "<html><head>",
    '<script>document.documentElement.dataset.theme="dark"</script>',
    '<link rel="icon" href="/favicon.svg">',
    "</head><body>",
    '<img src="/favicon.svg">',
    flightScripts,
    "</body></html>"
  ].join("");

  const html = rewritePreviewContent(
    Buffer.from(source),
    "text/html; charset=utf-8",
    basePath,
    {
      localOrigin: "http://127.0.0.1:3000",
      networkMode: "device-direct",
      upstreamUrl: new URL("http://127.0.0.1:3000/")
    }
  ).toString();

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 3);
  assert.equal(scripts[0]?.[1], 'document.documentElement.dataset.theme="dark"');
  assert.doesNotMatch(html, /__deskcuePreviewShim/);
  assert.match(html, new RegExp(`href="${basePath}/favicon\\.svg"`));
  assert.match(html, new RegExp(`src="${basePath}/favicon\\.svg"`));
  const rewrittenFlight = scripts.slice(1).map((match) => {
    const serialized = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/
      .exec(match[1])?.[1];
    assert.ok(serialized);
    return JSON.parse(serialized) as string;
  }).join("");
  assert.match(rewrittenFlight, new RegExp(`${basePath}/favicon\\.svg`));
  assert.match(rewrittenFlight, new RegExp(`${basePath}/_next/static/css/app\\.css`));
  assert.match(rewrittenFlight, /"href":"\/privacy"/);
});

test("device-direct shim routes dynamic chunks and HMR without proxying external requests", async () => {
  const basePath = "/api/preview/sessions/session-1";
  const script = createPreviewJavaScriptBootstrap(basePath, {
    localOrigin: "http://127.0.0.1:3000",
    networkMode: "device-direct",
    upstreamUrl: new URL("http://127.0.0.1:3000/")
  });
  const calls: string[] = [];
  const browserWindow = {
    EventSource: undefined,
    SharedWorker: undefined,
    Worker: undefined,
    WebSocket: class {
      constructor(url: string | URL) {
        calls.push(`ws:${url.toString()}`);
      }
    },
    async fetch(input: string | URL | Request) {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();
      calls.push(`fetch:${url}`);
      return new Response(null, { status: 204 });
    }
  };

  runInNewContext(script, {
    Request,
    URL,
    XMLHttpRequest: class { open() {} },
    btoa,
    location: new URL(`http://deskcue.test:4100${basePath}/`),
    navigator: {},
    window: browserWindow
  });
  await browserWindow.fetch("/_next/static/chunks/app.js");
  new browserWindow.WebSocket("ws://deskcue.test:4100/_next/webpack-hmr");
  await browserWindow.fetch("https://api.example.test/data");

  assert.deepEqual(calls, [
    `fetch:http://deskcue.test:4100${basePath}/_next/static/chunks/app.js`,
    `ws:ws://deskcue.test:4100${basePath}/_next/webpack-hmr`,
    "fetch:https://api.example.test/data"
  ]);
});

test("JavaScript bootstrap resolves relative requests from the stable document URL without Referer", async () => {
  const ownerPath = "/api/preview/sessions/session-1";
  const resourceBasePath = `${ownerPath}/__deskcue_ticket__/resource-token`;
  const script = createPreviewJavaScriptBootstrap(resourceBasePath, {
    localOrigin: "http://127.0.0.1:3000",
    networkMode: "device-direct",
    // Simulates the HTTP fallback when the opaque iframe omits Referer.
    upstreamUrl: new URL("http://127.0.0.1:3000/_next/static/chunks/app/page.js")
  });
  const calls: string[] = [];
  const browserWindow = {
    EventSource: undefined,
    SharedWorker: undefined,
    Worker: undefined,
    WebSocket: class {},
    async fetch(input: string | URL | Request) {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(null, { status: 204 });
    }
  };

  runInNewContext(script, {
    Request,
    URL,
    XMLHttpRequest: class { open() {} },
    atob,
    btoa,
    location: new URL(`http://deskcue.test:4100${ownerPath}/`),
    navigator: {},
    window: browserWindow
  });
  await browserWindow.fetch("api/profile");

  assert.deepEqual(calls, [
    `http://deskcue.test:4100${resourceBasePath}/api/profile`
  ]);
});

test("navigation shim safely routes black-box URLs with invalid percent sequences", async () => {
  const basePath = "/api/preview/sessions/session-1";
  const script = createPreviewJavaScriptBootstrap(basePath, {
    localOrigin: "http://127.0.0.1:3000",
    networkMode: "deskcue-host",
    upstreamUrl: new URL("http://127.0.0.1:3000/")
  });
  const calls: string[] = [];
  const browserWindow = {
    EventSource: undefined,
    SharedWorker: undefined,
    Worker: undefined,
    WebSocket: class {},
    async fetch(input: string | URL | Request) {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(null, { status: 204 });
    }
  };

  runInNewContext(script, {
    Request,
    URL,
    XMLHttpRequest: class { open() {} },
    atob,
    btoa,
    location: new URL(`http://deskcue.test:4100${basePath}/`),
    navigator: {},
    window: browserWindow
  });
  await browserWindow.fetch("http://localhost:9302/remoteEntry.build-%s.js");
  await browserWindow.fetch("http://localhost:9302/already-%25-safe.js");

  assert.equal(calls.length, 2);
  assert.match(calls[0]!, /remoteEntry\.build-%25s\.js$/);
  assert.match(calls[1]!, /already-%25-safe\.js$/);
});

test("navigation shim patches dynamic Next resource and navigation DOM sinks", () => {
  const resourceBasePath = "/api/preview/sessions/session-1/__deskcue_ticket__/resource-token";
  const script = createPreviewJavaScriptBootstrap(resourceBasePath, {
    localOrigin: "http://127.0.0.1:3000",
    networkMode: "device-direct",
    upstreamUrl: new URL("http://127.0.0.1:3000/nested/page")
  });

  class BrowserElement {
    readonly attributes = new Map<string, string>();
    target = "";
    urlValue = "";

    constructor(readonly tagName: string) {}

    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    }

    hasAttribute(name: string) {
      return this.attributes.has(name);
    }

    closest(selector: string) {
      return selector === "a[href]" && this.tagName === "A" && this.hasAttribute("href")
        ? this
        : null;
    }

    setAttribute(name: string, value: string) {
      this.attributes.set(name, String(value));
    }
  }
  const createUrlElement = (tagName: string, property: string) => {
    class BrowserUrlElement extends BrowserElement {
      constructor() { super(tagName); }
    }
    Object.defineProperty(BrowserUrlElement.prototype, property, {
      configurable: true,
      get(this: BrowserElement) { return this.urlValue; },
      set(this: BrowserElement, value: string) { this.urlValue = String(value); }
    });
    return BrowserUrlElement;
  };
  const BrowserAnchorElement = createUrlElement("A", "href");
  const BrowserFormElement = createUrlElement("FORM", "action");
  const BrowserImageElement = createUrlElement("IMG", "src");
  Object.defineProperty(BrowserImageElement.prototype, "srcset", {
    configurable: true,
    get(this: BrowserElement) { return this.urlValue; },
    set(this: BrowserElement, value: string) { this.urlValue = String(value); }
  });
  const BrowserLinkElement = createUrlElement("LINK", "href");
  const BrowserScriptElement = createUrlElement("SCRIPT", "src");
  const BrowserSourceElement = createUrlElement("SOURCE", "src");
  Object.defineProperty(BrowserSourceElement.prototype, "srcset", {
    configurable: true,
    get(this: BrowserElement) { return this.urlValue; },
    set(this: BrowserElement, value: string) { this.urlValue = String(value); }
  });
  const listeners: {
    click?: (event: {
      altKey: boolean;
      button: number;
      ctrlKey: boolean;
      defaultPrevented: boolean;
      metaKey: boolean;
      preventDefault(): void;
      shiftKey: boolean;
      target: BrowserElement;
    }) => void;
    submit?: (event: { target: BrowserElement }) => void;
  } = {};
  let assignedLocation: string | null = null;
  const browserLocation = new URL("http://deskcue.test:4100/api/preview/sessions/session-1/");
  Object.assign(browserLocation, {
    assign(value: string) { assignedLocation = value; }
  });

  runInNewContext(script, {
    Element: BrowserElement,
    HTMLAnchorElement: BrowserAnchorElement,
    HTMLFormElement: BrowserFormElement,
    HTMLImageElement: BrowserImageElement,
    HTMLLinkElement: BrowserLinkElement,
    HTMLScriptElement: BrowserScriptElement,
    HTMLSourceElement: BrowserSourceElement,
    Request,
    URL,
    XMLHttpRequest: class { open() {} },
    btoa,
    document: {
      addEventListener(name: string, listener: unknown) {
        if (name === "click") listeners.click = listener as NonNullable<typeof listeners.click>;
        if (name === "submit") listeners.submit = listener as NonNullable<typeof listeners.submit>;
      }
    },
    location: browserLocation,
    navigator: {},
    window: {
      EventSource: undefined,
      SharedWorker: undefined,
      Worker: undefined,
      WebSocket: class {},
      async fetch() { return new Response(null, { status: 204 }); }
    }
  });

  const scriptElement = new BrowserScriptElement();
  Reflect.set(scriptElement, "src", "/_next/static/chunks/runtime.js");
  assert.equal(
    scriptElement.urlValue,
    `http://deskcue.test:4100${resourceBasePath}/_next/static/chunks/runtime.js`
  );
  const image = new BrowserImageElement();
  image.setAttribute("srcset", "/image-1.png 1x, /image-2.png 2x");
  assert.equal(
    image.attributes.get("srcset"),
    `http://deskcue.test:4100${resourceBasePath}/image-1.png 1x, ` +
      `http://deskcue.test:4100${resourceBasePath}/image-2.png 2x`
  );
  const anchor = new BrowserAnchorElement();
  anchor.setAttribute("href", "/docs");
  assert.equal(anchor.attributes.get("href"), "/docs");
  assert.ok(listeners.click);
  let clickPrevented = false;
  listeners.click({
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    preventDefault() { clickPrevented = true; },
    shiftKey: false,
    target: anchor
  });
  assert.equal(clickPrevented, true);
  assert.equal(assignedLocation, `http://deskcue.test:4100${resourceBasePath}/docs`);
  const form = new BrowserFormElement();
  assert.ok(listeners.submit);
  listeners.submit({ target: form });
  assert.equal(form.urlValue, `http://deskcue.test:4100${resourceBasePath}/`);
});

test("generated host-routing shim executes and intercepts external browser transports", async () => {
  const basePath = "/api/preview/sessions/session-1";
  const script = createPreviewJavaScriptBootstrap(basePath, {
    localOrigin: "http://127.0.0.1:43120",
    networkMode: "deskcue-host",
    upstreamUrl: new URL("http://127.0.0.1:43120/")
  });
  const calls: string[] = [];
  const browserWindow: {
    EventSource: undefined;
    WebSocket: new (url: string | URL) => unknown;
    fetch: (input: string | URL | Request) => Promise<Response>;
  } = {
    EventSource: undefined,
    WebSocket: class {
      constructor(url: string | URL) {
        calls.push(`ws:${url.toString()}`);
      }
    },
    async fetch(input) {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();
      calls.push(`fetch:${url}`);
      return new Response(null, { status: 204 });
    }
  };
  class BrowserXmlHttpRequest {
    open(_method: string, url: string | URL) {
      calls.push(`xhr:${url.toString()}`);
    }
  }
  const navigator = {
    sendBeacon(url: string | URL) {
      calls.push(`beacon:${url.toString()}`);
      return true;
    }
  };

  runInNewContext(script, {
    Request,
    URL,
    XMLHttpRequest: BrowserXmlHttpRequest,
    btoa,
    location: new URL("http://deskcue.test:4100/preview"),
    navigator,
    window: browserWindow
  });
  await browserWindow.fetch("http://100.64.0.23:43121/set");
  new browserWindow.WebSocket("ws://100.64.0.23:43121/socket");
  navigator.sendBeacon("http://100.64.0.23:43121/beacon");
  new BrowserXmlHttpRequest().open("GET", "http://100.64.0.23:43121/check");

  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.match(call, /deskcue\.test:4100\/api\/preview\/sessions\/session-1\/__deskcue_egress__\//);
    assert.doesNotMatch(call, /100\.90\.9\.23:43121\/(?:set|socket|beacon|check)$/);
  }
  assert.match(calls[1], /^ws:ws:\/\//);
});

function createTestEgressResolver(): PreviewEgressResolver {
  return async (url) => ({
    lookup(_hostname, options, callback) {
      if (options.all) {
        callback(null, [{ address: "127.0.0.1", family: 4 }]);
        return;
      }
      callback(null, "127.0.0.1", 4);
    },
    url
  });
}

function readCookieHeader(response: Response) {
  return response.headers.getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

function readBootstrappedJavaScriptBody(value: string) {
  const interactions = value.indexOf("__deskcuePreviewInteractions");
  const separator = value.indexOf("\n", interactions);
  assert.ok(separator > 0, "Expected the Preview bootstrap before the JavaScript payload.");
  assert.match(value.slice(0, separator), /__deskcuePreviewShim/);
  return value.slice(separator + 1);
}

function readFirstEvalArgument(value: string) {
  const serialized = /\beval\(\s*(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.ts\(\s*)?("(?:\\.|[^"\\])*")/.exec(value)?.[1];
  assert.ok(serialized, "Expected an eval-wrapped Next module.");
  const decoded: unknown = JSON.parse(serialized);
  assert.equal(typeof decoded, "string");
  return decoded as string;
}

test("rewrites only direct static asset literals in a Next page bundle", () => {
  const basePath = "/api/preview/sessions/session-1/__deskcue_ticket__/resource-token";
  const evalModule = 'window.icon="/icons/eval.svg";';
  const source = String.raw`const icon="/favicon.svg";const image='/icons/hero.png?dark=1';const font="/__nextjs_font/inter.woff2";const api="/api/items.json";const matcher=/["']\/favicon\.svg/g;` +
    `eval(${JSON.stringify(evalModule)});`;
  const rewritten = rewritePreviewJavaScriptAssetLiterals(
    Buffer.from(source),
    basePath
  ).toString();

  assert.match(rewritten, new RegExp(`icon="${basePath}/favicon\\.svg"`));
  assert.match(rewritten, new RegExp(`image='${basePath}/icons/hero\\.png\\?dark=1'`));
  assert.match(rewritten, new RegExp(`font="${basePath}/__nextjs_font/inter\\.woff2"`));
  assert.match(rewritten, /api="\/api\/items\.json"/);
  assert.match(rewritten, /matcher=\/\["'\]\\\/favicon\\\.svg\/g/);
  assert.match(readFirstEvalArgument(rewritten), new RegExp(`window\\.icon="${basePath}/icons/eval\\.svg"`));
  assert.doesNotThrow(() => new Function(rewritten));
});

test("rewrites root-relative Vite module literals", () => {
  const basePath = "/api/preview/sessions/session-1/__deskcue_ticket__/resource-token";
  const source = [
    'import "/src/issues.css";',
    'import { IssueRow } from "/src/IssueRow.tsx";',
    'import React from "/node_modules/.vite/deps/react.js?v=449c2f80";',
    'import RefreshRuntime from "/@react-refresh";',
    'const api = "/api/items";'
  ].join("");
  const rewritten = rewritePreviewJavaScriptAssetLiterals(
    Buffer.from(source),
    basePath
  ).toString();

  assert.match(rewritten, new RegExp(`import "${basePath}/src/issues\\.css"`));
  assert.match(rewritten, new RegExp(`from "${basePath}/src/IssueRow\\.tsx"`));
  assert.match(rewritten, new RegExp(`from "${basePath}/node_modules/\\.vite/deps/react\\.js\\?v=449c2f80"`));
  assert.match(rewritten, new RegExp(`from "${basePath}/@react-refresh"`));
  assert.match(rewritten, /api = "\/api\/items"/);
});

function listen(server: Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP server address.");
      resolve(address.port);
    });
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function createProxyFixture(
  port: number,
  authRequired: () => boolean,
  options: {
    networkMode?: "deskcue-host" | "device-direct";
    previewProxyPort?: number;
    resolveEgressTarget?: PreviewEgressResolver;
  } = {}
) {
  const app = express();
  const controller = new PreviewProxyController({
    authRequired,
    previewProxyPort: options.previewProxyPort,
    resolveEgressTarget: options.resolveEgressTarget,
    resolveTarget: async (owner) => owner.id.startsWith("session-")
      ? {
        networkMode: options.networkMode ?? "device-direct",
        origin: `http://127.0.0.1:${port}`,
        port
      }
      : null
  });
  controller.installProxyRoutes(app);
  app.use(express.json());
  controller.installTicketRoute(app);
  const server = createServer(app);
  controller.attach(server);
  const proxyPort = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${proxyPort}`,
    controller,
    async close() {
      await controller.close();
      await close(server);
    }
  };
}

test("issues an absolute URL for the isolated Preview origin", async () => {
  const target = createServer((_request, response) => response.end("ok"));
  const targetPort = await listen(target);
  const fixture = await createProxyFixture(targetPort, () => false, {
    previewProxyPort: 42_101
  });

  try {
    const issued = await fetch(`${fixture.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const ticket = await issued.json() as { previewUrl: string };

    assert.equal(
      ticket.previewUrl,
      "http://127.0.0.1:42101/api/preview/sessions/session-1/"
    );
  } finally {
    await fixture.close();
    await close(target);
  }
});

test("preserves the browser-facing HTTPS scheme for the isolated Preview origin", async () => {
  const target = createServer((_request, response) => response.end("ok"));
  const targetPort = await listen(target);
  const fixture = await createProxyFixture(targetPort, () => false, {
    previewProxyPort: 42_101
  });

  try {
    const issued = await fetch(`${fixture.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: {
        "content-type": "application/json",
        origin: `https://127.0.0.1:${new URL(fixture.baseUrl).port}`
      },
      method: "POST"
    });
    const ticket = await issued.json() as { previewUrl: string };

    assert.equal(
      ticket.previewUrl,
      "https://127.0.0.1:42101/api/preview/sessions/session-1/"
    );
  } finally {
    await fixture.close();
    await close(target);
  }
});

test("does not trust X-Forwarded-Proto when building the isolated Preview URL", async () => {
  const target = createServer((_request, response) => response.end("ok"));
  const targetPort = await listen(target);
  const fixture = await createProxyFixture(targetPort, () => false, {
    previewProxyPort: 42_101
  });

  try {
    const issued = await fetch(`${fixture.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https"
      },
      method: "POST"
    });
    const ticket = await issued.json() as { previewUrl: string };

    assert.equal(
      ticket.previewUrl,
      "http://127.0.0.1:42101/api/preview/sessions/session-1/"
    );
  } finally {
    await fixture.close();
    await close(target);
  }
});

test("issues an owner-scoped ticket, forwards app auth and strips DeskCue cookies", async () => {
  let receivedAuthorization: string | undefined;
  let receivedCookie: string | undefined;
  const originalAsset = String.raw`const icon="/favicon.svg";const matcher=/["']\/favicon\.svg/g;(0,eval)('window.evalAsset="/eval-root"');document.body.dataset.previewAsset="loaded";`;
  const nextPageAsset = 'const icon="/favicon.svg";const font="/__nextjs_font/inter.woff2";';
  const decodedMainAppModule = String.raw`const css="src:url(/__nextjs_font/geist-latin.woff2) format('woff2')";const matcher=/["']\/icons\/app\.svg/g;const api="/api/items.json";`;
  const mainAppAsset = `eval(__webpack_require__.ts(${JSON.stringify(decodedMainAppModule)}));`;
  const target = createServer((request, response) => {
    receivedAuthorization = request.headers.authorization;
    receivedCookie = request.headers.cookie;
    if (request.url === "/_next/static/chunks/main.js") {
      response.setHeader("content-type", "application/javascript; charset=utf-8");
      response.end(originalAsset);
      return;
    }
    if (request.url === "/_next/static/chunks/app/page.js") {
      response.setHeader("content-type", "application/javascript; charset=utf-8");
      response.end(nextPageAsset);
      return;
    }
    if (request.url === "/_next/static/chunks/main-app.js") {
      response.setHeader("content-type", "application/javascript; charset=utf-8");
      response.end(mainAppAsset);
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("content-security-policy", "default-src 'none'");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader(
      "link",
      '</favicon.svg>; rel=preload; as=image, </icons/app.svg>; rel=preload; as=image, <https://cdn.example.test/app.svg>; rel=preload; as=image'
    );
    response.setHeader("set-cookie", "preview_app=value; Path=/");
    response.end('<html><head></head><body><script src="/_next/static/chunks/main.js"></script><script src="/_next/static/chunks/app/page.js"></script><script src="/_next/static/chunks/main-app.js"></script></body></html>');
  });
  const targetPort = await listen(target);
  let authRequired = false;
  const fixture = await createProxyFixture(targetPort, () => authRequired);

  try {
    const issued = await fetch(`${fixture.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    assert.equal(issued.status, 201);
    const ticket = await issued.json() as {
      credentialRevision: string;
      previewUrl: string;
    };
    assert.equal(ticket.previewUrl, "/api/preview/sessions/session-1/");
    assert.equal("ticket" in ticket, false);
    assert.match(ticket.credentialRevision, /^[A-Za-z0-9_-]{16}$/);
    const ticketCookies = readCookieHeader(issued);
    assert.match(ticketCookies, /deskcue_preview=/);

    authRequired = true;
    const preview = await fetch(`${fixture.baseUrl}${ticket.previewUrl}`, {
      headers: {
        authorization: "Bearer application-preview-token",
        cookie: ticketCookies
      }
    });
    assert.equal(preview.status, 200);
    assert.equal(receivedAuthorization, "Bearer application-preview-token");
    assert.equal(receivedCookie, undefined);
    assert.match(preview.headers.get("content-security-policy") ?? "", /^sandbox /);
    assert.match(preview.headers.get("content-security-policy") ?? "", /allow-same-origin/);
    assert.equal(preview.headers.get("x-frame-options"), null);
    const cookies = preview.headers.getSetCookie();
    assert.equal(
      cookies.some((value) => value.includes("preview_app=value") && value.includes("Path=/api/preview/sessions/session-1")),
      true
    );
    const html = await preview.text();
    const basePath = ticket.previewUrl.replace(/\/$/, "");
    assert.doesNotMatch(html, /<base\s/i);
    const nextAssetPath = /<script src="([^"]+)"/.exec(html)?.[1];
    assert.ok(nextAssetPath);
    assert.match(nextAssetPath, new RegExp(`^${basePath}/__deskcue_ticket__/[A-Za-z0-9_-]+/_next/`));
    const resourceBasePath = nextAssetPath.slice(0, nextAssetPath.indexOf("/_next/"));
    const linkHeader = preview.headers.get("link") ?? "";
    assert.match(linkHeader, new RegExp(`<${resourceBasePath}/favicon\\.svg>`));
    assert.match(linkHeader, new RegExp(`<${resourceBasePath}/icons/app\\.svg>`));
    assert.match(linkHeader, /<https:\/\/cdn\.example\.test\/app\.svg>/);
    assert.doesNotMatch(html, /__deskcuePreviewShim/);

    const opaqueAsset = await fetch(`${fixture.baseUrl}${nextAssetPath}`);
    assert.equal(opaqueAsset.status, 200);
    const opaqueAssetScript = await opaqueAsset.text();
    assert.match(opaqueAssetScript, /__deskcuePreviewShim/);
    assert.equal(readBootstrappedJavaScriptBody(opaqueAssetScript), originalAsset);
    const pageAssetPath = [...html.matchAll(/<script src="([^"]+)"/g)][1]?.[1];
    assert.ok(pageAssetPath);
    const pageAsset = await fetch(`${fixture.baseUrl}${pageAssetPath}`);
    assert.equal(pageAsset.status, 200);
    const rewrittenPageAsset = readBootstrappedJavaScriptBody(await pageAsset.text());
    const pageResourceBase = pageAssetPath.slice(0, pageAssetPath.indexOf("/_next/"));
    assert.equal(
      rewrittenPageAsset,
      `const icon="${pageResourceBase}/favicon.svg";` +
        `const font="${pageResourceBase}/__nextjs_font/inter.woff2";`
    );
    const mainAppPath = [...html.matchAll(/<script src="([^"]+)"/g)][2]?.[1];
    assert.ok(mainAppPath);
    const mainApp = await fetch(`${fixture.baseUrl}${mainAppPath}`);
    assert.equal(mainApp.status, 200);
    const rewrittenMainApp = readBootstrappedJavaScriptBody(await mainApp.text());
    assert.doesNotThrow(() => new Function(rewrittenMainApp));
    assert.match(rewrittenMainApp, /^eval\(__webpack_require__\.ts\(/);
    assert.match(rewrittenMainApp, /\)\);$/);
    const decodedMainApp = readFirstEvalArgument(rewrittenMainApp);
    assert.match(
      decodedMainApp,
      new RegExp(`url\\(${resourceBasePath}/__nextjs_font/geist-latin\\.woff2\\)`)
    );
    assert.match(decodedMainApp, /matcher=\/\["'\]\\\/icons\\\/app\\\.svg\/g/);
    assert.match(decodedMainApp, /api="\/api\/items\.json"/);

    const unauthorizedRootAsset = await fetch(`${fixture.baseUrl}/_next/static/chunks/main.js`, {
      headers: { referer: `${fixture.baseUrl}${ticket.previewUrl}` },
      redirect: "manual"
    });
    assert.equal(unauthorizedRootAsset.status, 404);

    const rootAsset = await fetch(`${fixture.baseUrl}/_next/static/chunks/main.js`, {
      headers: {
        cookie: ticketCookies,
        origin: "null",
        referer: `${fixture.baseUrl}${ticket.previewUrl}`
      },
      redirect: "manual"
    });
    assert.equal(rootAsset.status, 307);
    assert.equal(rootAsset.headers.get("location"), `${basePath}/_next/static/chunks/main.js`);
    assert.equal(rootAsset.headers.get("access-control-allow-origin"), "null");

    const opaqueSandboxAsset = await fetch(`${fixture.baseUrl}/_next/static/chunks/main.js`, {
      headers: {
        cookie: ticketCookies,
        "sec-fetch-site": "cross-site"
      },
      redirect: "manual"
    });
    assert.equal(opaqueSandboxAsset.status, 307);
    assert.equal(opaqueSandboxAsset.headers.get("location"), `${basePath}/_next/static/chunks/main.js`);

    const iframeNavigation = await fetch(`${fixture.baseUrl}/login`, {
      headers: {
        cookie: ticketCookies,
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "same-origin"
      },
      redirect: "manual"
    });
    assert.equal(iframeNavigation.status, 307);
    assert.equal(iframeNavigation.headers.get("location"), `${basePath}/login`);

    const ordinaryDeskCueAsset = await fetch(`${fixture.baseUrl}/_next/static/chunks/main.js`, {
      headers: {
        cookie: ticketCookies,
        "sec-fetch-site": "same-origin"
      },
      redirect: "manual"
    });
    assert.equal(ordinaryDeskCueAsset.status, 404);

    const foreignRefererAsset = await fetch(`${fixture.baseUrl}/_next/static/chunks/main.js`, {
      headers: {
        cookie: ticketCookies,
        referer: `http://foreign.test${ticket.previewUrl}`
      },
      redirect: "manual"
    });
    assert.equal(foreignRefererAsset.status, 404);

    const asset = await fetch(`${fixture.baseUrl}${basePath}/_next/static/chunks/main.js`, {
      headers: { cookie: ticketCookies }
    });
    assert.equal(asset.status, 200);
    assert.equal(readBootstrappedJavaScriptBody(await asset.text()), originalAsset);

    const legacyTicket = (fixture.controller as unknown as {
      ticketRegistry: {
        issue: (
          owner: { id: string; kind: "session" },
          viewerKey: string
        ) => { ticket: string };
      };
    }).ticketRegistry.issue({ id: "session-1", kind: "session" }, "local-preview").ticket;
    const legacy = await fetch(
      `${fixture.baseUrl}${basePath}/__deskcue_ticket__/${encodeURIComponent(legacyTicket)}/`
    );
    assert.equal(legacy.status, 200);
    assert.match(readCookieHeader(legacy), /deskcue_preview=/);

    authRequired = false;
    const rotatedResponse = await fetch(`${fixture.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: { "content-type": "application/json", cookie: ticketCookies },
      method: "POST"
    });
    const rotated = await rotatedResponse.json() as {
      credentialRevision: string;
      previewUrl: string;
    };
    assert.equal(rotated.previewUrl, ticket.previewUrl);
    assert.equal(rotated.credentialRevision, ticket.credentialRevision);
    assert.equal("ticket" in rotated, false);
    assert.notEqual(readCookieHeader(rotatedResponse), ticketCookies);
    const rotatedPreview = await fetch(`${fixture.baseUrl}${rotated.previewUrl}`, {
      headers: { cookie: readCookieHeader(rotatedResponse) }
    });
    assert.equal(/<script src="([^"]+)"/.exec(await rotatedPreview.text())?.[1], nextAssetPath);
    authRequired = true;

    const wrongOwner = await fetch(
      `${fixture.baseUrl}/api/preview/sessions/session-2/?deskcuePreviewTicket=${encodeURIComponent(legacyTicket)}`
    );
    assert.equal(wrongOwner.status, 401);
  } finally {
    await fixture.close();
    await close(target);
  }
});

test("a fresh daemon registry replaces the non-secret Preview credential revision", async () => {
  const target = createServer((_request, response) => response.end("ok"));
  const targetPort = await listen(target);
  const first = await createProxyFixture(targetPort, () => false);
  let firstClosed = false;
  let second: Awaited<ReturnType<typeof createProxyFixture>> | null = null;

  try {
    const firstResponse = await fetch(`${first.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const firstTicket = await firstResponse.json() as {
      credentialRevision: string;
      previewUrl: string;
    };
    const staleCookie = readCookieHeader(firstResponse);
    await first.close();
    firstClosed = true;

    second = await createProxyFixture(targetPort, () => false);
    const secondResponse = await fetch(`${second.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: { "content-type": "application/json", cookie: staleCookie },
      method: "POST"
    });
    const secondTicket = await secondResponse.json() as {
      credentialRevision: string;
      previewUrl: string;
    };
    assert.equal(secondTicket.previewUrl, firstTicket.previewUrl);
    assert.notEqual(secondTicket.credentialRevision, firstTicket.credentialRevision);
    assert.equal("ticket" in secondTicket, false);
  } finally {
    if (second) await second.close();
    else if (!firstClosed) await first.close();
    await close(target);
  }
});

test("rewrites same-target redirects and leaves external redirects device-direct", async () => {
  const target = createServer((request, response) => {
    response.statusCode = 302;
    response.setHeader("location", request.url === "/external"
      ? "https://example.com/escape"
      : "/nested/page?ok=1");
    response.end();
  });
  const targetPort = await listen(target);
  const fixture = await createProxyFixture(targetPort, () => false);

  try {
    const internal = await fetch(`${fixture.baseUrl}/api/preview/sessions/session-1/start`, {
      redirect: "manual"
    });
    assert.equal(internal.status, 302);
    assert.equal(
      internal.headers.get("location"),
      "/api/preview/sessions/session-1/nested/page?ok=1"
    );

    const external = await fetch(`${fixture.baseUrl}/api/preview/sessions/session-1/external`, {
      redirect: "manual"
    });
    assert.equal(external.status, 302);
    assert.equal(external.headers.get("location"), "https://example.com/escape");
  } finally {
    await fixture.close();
    await close(target);
  }
});

test("does not issue a preview ticket when the configured app is unavailable", async () => {
  const target = createServer();
  const targetPort = await listen(target);
  await close(target);
  const fixture = await createProxyFixture(targetPort, () => true);

  try {
    const response = await fetch(`${fixture.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "The local preview server is unavailable."
    });
  } finally {
    await fixture.close();
  }
});

test("rejects an oversized upstream response before streaming it to the browser", async () => {
  const target = createServer((_request, response) => {
    response.setHeader("content-length", PREVIEW_PROXY_LIMITS.maxResponseBytes + 1);
    response.end();
  });
  const targetPort = await listen(target);
  const fixture = await createProxyFixture(targetPort, () => false);

  try {
    const response = await fetch(`${fixture.baseUrl}/api/preview/sessions/session-1/large`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "Preview response is too large." });
  } finally {
    await fixture.close();
    await close(target);
  }
});

test("rejects oversized Next application JavaScript before buffering it for rewrite", async () => {
  const target = createServer((_request, response) => {
    response.setHeader("content-type", "application/javascript; charset=utf-8");
    response.setHeader("content-length", MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES + 1);
    response.end();
  });
  const targetPort = await listen(target);
  const fixture = await createProxyFixture(targetPort, () => false);
  try {
    const issued = await fetch(`${fixture.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const cookie = readCookieHeader(issued);
    const response = await fetch(
      `${fixture.baseUrl}/api/preview/sessions/session-1/_next/static/chunks/app/page.js`,
      { headers: { cookie } }
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "Preview JavaScript is too large to rewrite safely."
    });
  } finally {
    await fixture.close();
    await close(target);
  }
});

test("rewrites proxied Vite application modules", async () => {
  const source = [
    'import "/src/issues.css";',
    'import { IssueRow } from "/src/IssueRow.tsx";',
    'import React from "/node_modules/.vite/deps/react.js?v=449c2f80";'
  ].join("");
  const target = createServer((request, response) => {
    assert.equal(request.url, "/src/main.tsx");
    response.setHeader("content-type", "text/javascript; charset=utf-8");
    response.end(source);
  });
  const targetPort = await listen(target);
  const fixture = await createProxyFixture(targetPort, () => false);
  const basePath = "/api/preview/sessions/session-1";

  try {
    const response = await fetch(`${fixture.baseUrl}${basePath}/src/main.tsx`);
    assert.equal(response.status, 200);
    const rewritten = readBootstrappedJavaScriptBody(await response.text());
    assert.match(rewritten, new RegExp(`import "${basePath}/src/issues\\.css"`));
    assert.match(rewritten, new RegExp(`from "${basePath}/src/IssueRow\\.tsx"`));
    assert.match(rewritten, new RegExp(`from "${basePath}/node_modules/\\.vite/deps/react\\.js\\?v=449c2f80"`));
  } finally {
    await fixture.close();
    await close(target);
  }
});

test("proxies preview WebSocket traffic through the DeskCue listener", async () => {
  const targetServer = createServer((_request, response) => response.writeHead(204).end());
  const targetWebSocket = new WebSocketServer({ server: targetServer });
  targetWebSocket.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(`echo:${data.toString()}`));
  });
  const targetPort = await listen(targetServer);
  let authRequired = false;
  const fixture = await createProxyFixture(targetPort, () => authRequired);

  try {
    const issueResponse = await fetch(`${fixture.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const issued = await issueResponse.json() as { previewUrl: string };
    const ticketCookies = readCookieHeader(issueResponse);
    authRequired = true;
    const reply = await new Promise<string>((resolve, reject) => {
      const socketUrl = new URL(issued.previewUrl, fixture.baseUrl);
      socketUrl.pathname = `${socketUrl.pathname}hmr`;
      socketUrl.protocol = "ws:";
      const socket = new WebSocket(socketUrl, { headers: { cookie: ticketCookies } });
      socket.once("open", () => socket.send("ready"));
      socket.once("message", (data) => {
        resolve(data.toString());
        socket.close();
      });
      socket.once("error", reject);
    });
    assert.equal(reply, "echo:ready");
  } finally {
    await fixture.close();
    await new Promise<void>((resolve) => targetWebSocket.close(() => resolve()));
    await close(targetServer);
  }
});

test("host-routed preview proxies external HTTP redirects and keeps cookies origin-scoped", async () => {
  const received: Array<{ authorization?: string; cookie?: string; url?: string }> = [];
  const external = createServer((request, response) => {
    received.push({
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      url: request.url
    });
    if (request.url === "/start") {
      response.statusCode = 302;
      response.setHeader("location", "/events");
      response.setHeader("set-cookie", "vpn_session=private; Path=/; HttpOnly");
      response.end();
      return;
    }
    response.setHeader("content-type", "text/event-stream");
    response.end("data: connected\n\n");
  });
  const externalPort = await listen(external);
  const fixture = await createProxyFixture(externalPort, () => false, {
    networkMode: "deskcue-host",
    resolveEgressTarget: createTestEgressResolver()
  });

  try {
    const target = new URL(`http://vpn.corp.test:${externalPort}/start`);
    const path = buildPreviewEgressPath(
      "/api/preview/sessions/session-1",
      target
    );
    const response = await fetch(`${fixture.baseUrl}${path}`, {
      headers: {
        authorization: "Bearer app-session-token",
        cookie: "deskcue_access=must-not-leak; app_browser_cookie=also-must-not-leak"
      }
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "data: connected\n\n");
    assert.equal(response.headers.getSetCookie().some((value) => value.includes("vpn_session")), false);
    assert.deepEqual(received, [
      {
        authorization: "Bearer app-session-token",
        cookie: undefined,
        url: "/start"
      },
      {
        authorization: "Bearer app-session-token",
        cookie: "vpn_session=private",
        url: "/events"
      }
    ]);
  } finally {
    await fixture.close();
    await close(external);
  }
});

test("host-routed preview rewrites external resources and relays external WebSockets", async () => {
  const externalServer = createServer((_request, response) => response.writeHead(204).end());
  const externalWebSocket = new WebSocketServer({ server: externalServer });
  externalWebSocket.on("connection", (socket) => {
    socket.on("message", (data) => {
      socket.send(`vpn:${data.toString()}`);
      socket.close();
    });
  });
  const externalPort = await listen(externalServer);
  const local = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<html><head></head><body><img src="http://assets.corp.test:${externalPort}/logo.png"></body></html>`);
  });
  const localPort = await listen(local);
  const fixture = await createProxyFixture(localPort, () => false, {
    networkMode: "deskcue-host",
    resolveEgressTarget: createTestEgressResolver()
  });

  try {
    const preview = await fetch(`${fixture.baseUrl}/api/preview/sessions/session-1/`);
    const html = await preview.text();
    assert.match(html, /__deskcue_egress__/);
    assert.doesNotMatch(html, /src="http:\/\/assets\.corp\.test/);
    assert.doesNotMatch(html, /__deskcuePreviewShim/);
    assert.doesNotThrow(() => new Function(createPreviewJavaScriptBootstrap(
      "/api/preview/sessions/session-1",
      {
        localOrigin: `http://127.0.0.1:${localPort}`,
        networkMode: "deskcue-host",
        upstreamUrl: new URL(`http://127.0.0.1:${localPort}/`)
      }
    )));

    const externalTarget = new URL(`ws://socket.corp.test:${externalPort}/updates`);
    const externalPath = buildPreviewEgressPath(
      "/api/preview/sessions/session-1",
      externalTarget
    );
    const reply = await new Promise<string>((resolve, reject) => {
      const socketUrl = new URL(externalPath, fixture.baseUrl);
      socketUrl.protocol = "ws:";
      const socket = new WebSocket(socketUrl);
      let received: string | null = null;
      socket.once("open", () => socket.send("ready"));
      socket.once("message", (data) => {
        received = data.toString();
      });
      socket.once("close", () => received ? resolve(received) : reject(new Error("Preview WebSocket closed before its reply.")));
      socket.once("error", reject);
    });
    assert.equal(reply, "vpn:ready");
  } finally {
    await fixture.close();
    await new Promise<void>((resolve) => externalWebSocket.close(() => resolve()));
    await close(externalServer);
    await close(local);
  }
});

test("host-routed external documents keep root-relative assets on their egress origin", async () => {
  const received: string[] = [];
  const external = createServer((request, response) => {
    received.push(`${request.headers.host}${request.url}`);
    if (request.url === "/bundle.js") {
      response.setHeader("content-type", "application/javascript; charset=utf-8");
      response.end("window.previewBundleLoaded = true;");
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader(
      "referrer-policy",
      request.url === "/origin-policy" ? "origin" : "no-referrer"
    );
    response.end('<html><head></head><body><script src="/bundle.js"></script></body></html>');
  });
  const externalPort = await listen(external);
  const fixture = await createProxyFixture(externalPort, () => false, {
    networkMode: "deskcue-host",
    resolveEgressTarget: createTestEgressResolver()
  });

  try {
    const issueResponse = await fetch(`${fixture.baseUrl}/api/preview/tickets`, {
      body: JSON.stringify({ kind: "session", ownerId: "session-1" }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const issued = await issueResponse.json() as { previewUrl: string };
    const ticketCookies = readCookieHeader(issueResponse);
    const externalOrigin = `http://vpn.corp.test:${externalPort}`;

    for (const documentPath of ["/no-referrer-policy", "/origin-policy"]) {
      const egressDocumentPath = buildPreviewEgressPath(
        issued.previewUrl.replace(/\/$/, ""),
        new URL(documentPath, externalOrigin)
      );
      const documentResponse = await fetch(`${fixture.baseUrl}${egressDocumentPath}`, {
        headers: { cookie: ticketCookies }
      });
      assert.equal(documentResponse.status, 200);
      assert.equal(documentResponse.headers.get("referrer-policy"), "same-origin");
      const documentHtml = await documentResponse.text();
      const routedAssetPath = /<script src="([^"]+)"/.exec(documentHtml)?.[1];
      assert.ok(routedAssetPath);
      assert.match(routedAssetPath, /__deskcue_ticket__\/[A-Za-z0-9_-]+\/__deskcue_egress__\//);
      const routedAssetResponse = await fetch(`${fixture.baseUrl}${routedAssetPath}`);
      assert.equal(routedAssetResponse.status, 200);
      assert.match(await routedAssetResponse.text(), /window\.previewBundleLoaded = true;$/);

      const rootAssetRedirect = await fetch(`${fixture.baseUrl}/bundle.js`, {
        headers: {
          cookie: ticketCookies,
          referer: `${fixture.baseUrl}${egressDocumentPath}`
        },
        redirect: "manual"
      });
      assert.equal(rootAssetRedirect.status, 307);
      const expectedAssetPath = buildPreviewEgressPath(
        issued.previewUrl.replace(/\/$/, ""),
        new URL("/bundle.js", externalOrigin)
      );
      assert.equal(rootAssetRedirect.headers.get("location"), expectedAssetPath);

      const assetResponse = await fetch(`${fixture.baseUrl}${expectedAssetPath}`, {
        headers: { cookie: ticketCookies }
      });
      assert.equal(assetResponse.status, 200);
      assert.match(await assetResponse.text(), /window\.previewBundleLoaded = true;$/);
    }
    assert.equal(received.filter((entry) => entry.endsWith("/bundle.js")).length, 4);
  } finally {
    await fixture.close();
    await close(external);
  }
});

test("detached Preview response failures return a bounded gateway error", async () => {
  const target = createServer((_request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end("<html><head></head><body>ok</body></html>");
  });
  const targetPort = await listen(target);
  const fixture = await createProxyFixture(targetPort, () => false);
  const relay = (fixture.controller as unknown as {
    httpRelay: { forwardResponse: (...args: unknown[]) => Promise<void> };
  }).httpRelay;
  relay.forwardResponse = async () => {
    throw new Error("synthetic detached response failure");
  };

  try {
    const response = await fetch(`${fixture.baseUrl}/api/preview/sessions/session-1/`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "The preview response could not be processed."
    });
  } finally {
    await fixture.close();
    await close(target);
  }
});

test("host-routed cross-origin redirects do not forward application authorization", async () => {
  const receivedAuthorization: Array<string | undefined> = [];
  let externalPort = 0;
  const external = createServer((request, response) => {
    receivedAuthorization.push(request.headers.authorization);
    if (request.url === "/redirect") {
      response.statusCode = 302;
      response.setHeader("location", `http://api.corp.test:${externalPort}/result`);
      response.end();
      return;
    }
    response.end("ok");
  });
  externalPort = await listen(external);
  const fixture = await createProxyFixture(externalPort, () => false, {
    networkMode: "deskcue-host",
    resolveEgressTarget: createTestEgressResolver()
  });

  try {
    const path = buildPreviewEgressPath(
      "/api/preview/sessions/session-1",
      new URL(`http://login.corp.test:${externalPort}/redirect`)
    );
    const response = await fetch(`${fixture.baseUrl}${path}`, {
      headers: { authorization: "Bearer app-session-token" }
    });
    assert.equal(await response.text(), "ok");
    assert.deepEqual(receivedAuthorization, ["Bearer app-session-token", undefined]);
  } finally {
    await fixture.close();
    await close(external);
  }
});

test("device-direct preview rejects egress routes and production egress blocks loopback", async () => {
  const target = createServer((_request, response) => response.end("not reachable"));
  const targetPort = await listen(target);
  const fixture = await createProxyFixture(targetPort, () => false);

  try {
    const path = buildPreviewEgressPath(
      "/api/preview/sessions/session-1",
      new URL(`http://example.test:${targetPort}/private`)
    );
    const response = await fetch(`${fixture.baseUrl}${path}`);
    assert.equal(response.status, 403);
    await assert.rejects(
      resolvePreviewEgressTarget(new URL(`http://127.0.0.1:${targetPort}/private`)),
      /not allowed|protected address/
    );
    const allowedCompanion = await resolvePreviewEgressTarget(
      new URL(`http://localhost:${targetPort}/private`),
      { allowLoopback: true }
    );
    assert.equal(allowedCompanion.url.href, `http://localhost:${targetPort}/private`);
    for (const address of [
      "::ffff:7f00:1",
      "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe"
    ]) {
      await assert.rejects(
        resolvePreviewEgressTarget(new URL(`http://[${address}]:${targetPort}/private`)),
        /protected address/
      );
    }
  } finally {
    await fixture.close();
    await close(target);
  }
});
