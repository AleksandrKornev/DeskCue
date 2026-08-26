import { resolvePreviewEgressTarget } from "../egress/previewEgressTarget.ts";
import type { PreviewEgressResolver } from "../egress/previewEgressTarget.ts";

export async function resolvePreviewHttpEgressTarget(target: URL, resolver?: PreviewEgressResolver) {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Preview HTTP egress target is invalid.");
  }

  const resolved = resolver
    ? await resolver(target)
    : await resolvePreviewEgressTarget(target, { allowLoopback: true });
  return { ...resolved, egress: true as const };
}

export async function resolvePreviewWebSocketEgressTarget(target: URL, resolver?: PreviewEgressResolver) {
  if (target.protocol !== "ws:" && target.protocol !== "wss:") {
    throw new Error("Preview WebSocket egress target is invalid.");
  }

  const validationUrl = new URL(target);

  validationUrl.protocol = target.protocol === "wss:" ? "https:" : "http:";
  const resolved = resolver
    ? await resolver(validationUrl)
    : await resolvePreviewEgressTarget(validationUrl, { allowLoopback: true });
  const url = new URL(resolved.url);

  url.protocol = target.protocol;

  return { lookup: resolved.lookup, url };
}
