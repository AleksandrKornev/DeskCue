import type { IncomingHttpHeaders } from "node:http";

import type { CloudPreviewHeader } from "@deskcue/protocol/cloud";
import { copyPreviewResponseHeaders } from "#http/routes/system/preview/relay/previewProxyHeaders";

export function collectCloudPreviewResponseHeaders(
  input: IncomingHttpHeaders,
  options: {
    contentRewritten: boolean;
    exposeCookies: boolean;
    preserveCookiePaths?: boolean;
    preserveSecurityHeaders?: boolean;
    requestOrigin: string | undefined;
    upstreamOrigin: string;
  }
) {
  const values = new Map<string, number | string | string[]>();

  copyPreviewResponseHeaders(input, {
    getHeader: (name) => values.get(name),
    setHeader(name, value) {
      const storedValue = typeof value === "number" || typeof value === "string"
        ? value
        : Array.from(value);

      values.set(name, storedValue);
    }
  }, {
    basePath: "",
    contentRewritten: options.contentRewritten,
    exposeCookies: options.exposeCookies,
    preserveCookiePaths: options.preserveCookiePaths,
    preserveSecurityHeaders: options.preserveSecurityHeaders,
    requestOrigin: options.requestOrigin,
    resourceBasePath: "",
    upstreamOrigin: options.upstreamOrigin
  });

  const headers: CloudPreviewHeader[] = [];

  for (const [name, rawValue] of values) {
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      headers.push([name, String(value)]);
    }
  }

  return headers;
}
