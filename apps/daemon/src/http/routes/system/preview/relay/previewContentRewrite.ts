import { buildPreviewEgressPath } from "../egress/previewEgressTarget.ts";
import {
  isPreviewStaticAssetLiteral,
  rewritePreviewJavaScriptAssetLiterals,
  serializePreviewScriptString
} from "../rewrite/previewJavaScriptRewrite.ts";
import { createPreviewNavigationBootstrap } from "../rewrite/previewNavigationBootstrap.ts";

export {
  MAX_REWRITABLE_PREVIEW_JAVASCRIPT_BYTES,
  rewritePreviewJavaScriptAssetLiterals
} from "../rewrite/previewJavaScriptRewrite.ts";

const MAX_REWRITABLE_BODY_BYTES = 2 * 1024 * 1024;

type PreviewRewriteOptions = {
  localOrigin?: string;
  networkMode?: "deskcue-host" | "device-direct";
  upstreamUrl?: URL;
};

const NEXT_FLIGHT_SCRIPT_PATTERN =
  /<script>self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)<\/script>/g;

export function isRewritablePreviewContent(contentType: string | undefined) {
  return Boolean(
    contentType &&
      (contentType.toLowerCase().includes("text/html") ||
        contentType.toLowerCase().includes("text/css"))
  );
}

export function isPreviewJavaScriptContent(contentType: string | undefined) {
  const normalized = contentType?.toLowerCase() ?? "";

  return normalized.includes("javascript") || normalized.includes("ecmascript");
}

export async function readRewritablePreviewBody(
  source: NodeJS.ReadableStream,
  maxBytes = MAX_REWRITABLE_BODY_BYTES
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of source) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    bytes += buffer.byteLength;

    if (bytes > maxBytes) throw new Error("Preview content exceeds its rewrite limit.");

    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

function readQuotedHtmlAttribute(tag: string, attribute: string) {
  return new RegExp(`\\s${attribute}=["']([^"']*)["']`, "i").exec(tag)?.[1] ?? null;
}

function isStaticResourceLink(tag: string) {
  const rel = readQuotedHtmlAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];

  if (rel.some((value) => ["stylesheet", "icon", "manifest", "modulepreload"].includes(value))) return true;
  if (!rel.includes("preload")) return false;

  return ["font", "image", "script", "style"].includes(
    readQuotedHtmlAttribute(tag, "as")?.toLowerCase() ?? ""
  );
}

function rewriteRootCssUrls(value: string, basePath: string) {
  return value.replace(/url\(\s*(["']?)\/(?!\/)/gi, `url($1${basePath}/`);
}

export function createPreviewJavaScriptBootstrap(
  basePath: string,
  options: PreviewRewriteOptions
) {
  return createPreviewNavigationBootstrap(basePath, options);
}

function isLoopbackHostname(value: string) {
  return value === "localhost" || value === "127.0.0.1" || value === "[::1]" || value === "::1";
}

function effectivePort(value: URL) {
  return value.port || (value.protocol === "https:" || value.protocol === "wss:" ? "443" : "80");
}

function isLocalPreviewUrl(target: URL, localOrigin: string) {
  const local = new URL(localOrigin);

  if (target.origin === local.origin) return true;

  return (
    isLoopbackHostname(target.hostname) &&
    isLoopbackHostname(local.hostname) &&
    effectivePort(target) === effectivePort(local)
  );
}

function rewriteResourceUrl(
  rawUrl: string,
  upstreamUrl: URL,
  localOrigin: string,
  basePath: string,
  routeExternal: boolean
) {
  if (!rawUrl || /^(?:data|blob|javascript|mailto|tel):/i.test(rawUrl) || rawUrl.startsWith("#")) return null;

  try {
    const target = new URL(rawUrl, upstreamUrl);

    if (target.protocol !== "http:" && target.protocol !== "https:") return null;

    return isLocalPreviewUrl(target, localOrigin)
      ? `${basePath}${target.pathname}${target.search}${target.hash}`
      : routeExternal
        ? buildPreviewEgressPath(basePath, target)
        : null;
  } catch {
    return null;
  }
}

function rewriteSrcSet(
  value: string,
  upstreamUrl: URL,
  localOrigin: string,
  basePath: string,
  routeExternal: boolean
) {
  return value.split(",").map((candidate) => {
    const [rawUrl, ...descriptor] = candidate.trim().split(/\s+/);
    const url = rewriteResourceUrl(
      rawUrl,
      upstreamUrl,
      localOrigin,
      basePath,
      routeExternal
    ) ?? rawUrl;

    return [url, ...descriptor].join(" ");
  }).join(", ");
}

function rewriteCssUrls(
  value: string,
  upstreamUrl: URL,
  localOrigin: string,
  basePath: string,
  routeExternal: boolean
) {
  const withUrls = value.replace(
    /url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi,
    (match, quote: string, rawUrl: string) => {
      const rewritten = rewriteResourceUrl(
        rawUrl,
        upstreamUrl,
        localOrigin,
        basePath,
        routeExternal
      );

      return rewritten ? `url(${quote}${rewritten}${quote})` : match;
    }
  );

  return withUrls.replace(
    /@import\s+(["'])([^"']+)\1/gi,
    (match, quote: string, rawUrl: string) => {
      const rewritten = rewriteResourceUrl(
        rawUrl,
        upstreamUrl,
        localOrigin,
        basePath,
        routeExternal
      );

      return rewritten ? `@import ${quote}${rewritten}${quote}` : match;
    }
  );
}

function rewriteNextFlightResourceStrings(
  value: string,
  upstreamUrl: URL,
  localOrigin: string,
  basePath: string,
  routeExternal: boolean
) {
  const withProps = value.replace(
    /(\"(?:href|src|srcSet|srcset)\"\s*:\s*\")([^\"]*)(\")/g,
    (match, prefix: string, rawUrl: string, suffix: string) => {
      if (prefix.includes('"href"') && !isPreviewStaticAssetLiteral(rawUrl, basePath)) return match;

      const rewritten = rewriteResourceUrl(
        rawUrl,
        upstreamUrl,
        localOrigin,
        basePath,
        routeExternal
      );

      return rewritten ? `${prefix}${rewritten}${suffix}` : match;
    }
  );

  return withProps.replace(
    /(:HL\[\")([^\"]*)(\")/g,
    (match, prefix: string, rawUrl: string, suffix: string) => {
      const rewritten = rewriteResourceUrl(
        rawUrl,
        upstreamUrl,
        localOrigin,
        basePath,
        routeExternal
      );

      return rewritten ? `${prefix}${rewritten}${suffix}` : match;
    }
  );
}

function rewriteNextFlightPayload(
  value: string,
  upstreamUrl: URL,
  localOrigin: string,
  basePath: string,
  routeExternal: boolean
) {
  const matches = [...value.matchAll(new RegExp(NEXT_FLIGHT_SCRIPT_PATTERN.source, "g"))];

  if (matches.length === 0) return value;

  const chunks = matches.map((match) => {
    try {
      const parsed: unknown = JSON.parse(match[1]);

      return typeof parsed === "string" ? parsed : "";
    } catch {
      return "";
    }
  });
  const source = chunks.join("");
  const rewritten = rewriteNextFlightResourceStrings(
    source,
    upstreamUrl,
    localOrigin,
    basePath,
    routeExternal
  );

  if (source === rewritten) return value;

  let chunkIndex = 0;
  let offset = 0;

  return value.replace(
    new RegExp(NEXT_FLIGHT_SCRIPT_PATTERN.source, "g"),
    (script) => {
      const originalChunk = chunks[chunkIndex] ?? "";
      const finalChunk = chunkIndex === chunks.length - 1;
      const length = finalChunk
        ? rewritten.length - offset
        : Math.min(originalChunk.length, rewritten.length - offset);
      const chunk = rewritten.slice(offset, offset + Math.max(0, length));

      offset += chunk.length;

      chunkIndex += 1;
      return script.replace(
        /\[1,"(?:\\.|[^"\\])*"\]/,
        `[1,${serializePreviewScriptString(chunk)}]`
      );
    }
  );
}

function readCharset(contentType: string): BufferEncoding {
  const charset = /charset=([^;\s]+)/i.exec(contentType)?.[1]?.toLowerCase();

  return charset === "latin1" || charset === "ascii" ? charset : "utf8";
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function rewriteQuotedHtmlAttribute(
  tag: string,
  attribute: string,
  rewrite: (value: string) => string | null
) {
  const pattern = new RegExp(`(\\s${attribute}=)(["'])([^"']*)(\\2)`, "i");

  return tag.replace(pattern, (match, prefix: string, quote: string, rawValue: string) => {
    const rewritten = rewrite(rawValue);

    return rewritten ? `${prefix}${quote}${escapeHtmlAttribute(rewritten)}${quote}` : match;
  });
}

function rewriteHtmlUrls(
  value: string,
  upstreamUrl: URL,
  localOrigin: string,
  basePath: string,
  routeExternal: boolean
) {
  return value.replace(/<(script|link|img|source)\b[^>]*>/gi, (tag, rawTagName: string) => {
    const tagName = rawTagName.toLowerCase();

    if (tagName === "link" && !isStaticResourceLink(tag)) return tag;

    const primaryAttribute = tagName === "link" ? "href" : "src";
    let rewrittenTag = rewriteQuotedHtmlAttribute(tag, primaryAttribute, (rawUrl) =>
      rewriteResourceUrl(rawUrl, upstreamUrl, localOrigin, basePath, routeExternal)
    );

    if (tagName === "img" || tagName === "source") {
      rewrittenTag = rewriteQuotedHtmlAttribute(rewrittenTag, "srcset", (rawValue) =>
        rewriteSrcSet(rawValue, upstreamUrl, localOrigin, basePath, routeExternal)
      );
    }

    return rewrittenTag;
  });
}

function rewriteInlineModuleScripts(value: string, basePath: string) {
  return value.replace(
    /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
    (script, openingTag: string, source: string, closingTag: string) => {
      if (readQuotedHtmlAttribute(openingTag, "src") !== null) return script;
      if (readQuotedHtmlAttribute(openingTag, "type")?.toLowerCase() !== "module") return script;

      const rewritten = rewritePreviewJavaScriptAssetLiterals(
        Buffer.from(source, "utf8"),
        basePath
      ).toString("utf8");

      return `${openingTag}${rewritten}${closingTag}`;
    }
  );
}

export function rewritePreviewContent(
  body: Buffer,
  contentType: string,
  basePath: string,
  options: PreviewRewriteOptions = {}
) {
  const text = body.toString(readCharset(contentType));
  const hostRouted = options.networkMode === "deskcue-host";
  const upstreamUrl = options.upstreamUrl;

  if (contentType.toLowerCase().includes("text/css")) {
    const rewritten = upstreamUrl && options.localOrigin
      ? rewriteCssUrls(
        text,
        upstreamUrl,
        options.localOrigin,
        basePath,
        hostRouted
      )
      : rewriteRootCssUrls(text, basePath);
    return Buffer.from(rewritten, "utf8");
  }

  const withUrls = upstreamUrl && options.localOrigin
    ? rewriteHtmlUrls(
      text,
      upstreamUrl,
      options.localOrigin,
      basePath,
      hostRouted
    )
    : text;
  const withInlineModules = rewriteInlineModuleScripts(withUrls, basePath);
  const rewritten = upstreamUrl && options.localOrigin
    ? rewriteNextFlightPayload(
      withInlineModules,
      upstreamUrl,
      options.localOrigin,
      basePath,
      hostRouted
    )
    : withInlineModules;
  return Buffer.from(rewritten, "utf8");
}

// HTTP relay response rewriting belongs with the relay pipeline.
