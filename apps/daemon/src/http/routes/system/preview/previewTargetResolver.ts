import type { PreviewConfig, PreviewOwnerKind } from "@deskcue/protocol";
import type { DaemonApplication } from "#application/daemonApplication";
import { AppError } from "#application/errors";

import { buildPreviewLoopbackOrigin } from "./previewLoopback.ts";

export type PreviewOwner = {
  id: string;
  kind: PreviewOwnerKind;
};

export type ResolvedPreviewTarget = {
  networkMode: "deskcue-host" | "device-direct";
  origin: string;
  port: number;
};

export type PreviewTargetResolver = (
  owner: PreviewOwner
) => Promise<ResolvedPreviewTarget | null>;

export type PreviewConfiguredPortReader = (owner: PreviewOwner) => Promise<number | null>;

async function readPreviewConfig(
  application: Pick<DaemonApplication, "localLlmChats" | "managedSessions">,
  owner: PreviewOwner
) {
  if (owner.kind === "session") {
    const session = application.managedSessions.getSession(owner.id);
    if (!session) throw new AppError("not_found", "Session was not found.");
    return session.preview;
  }
  return application.localLlmChats.getPreviewConfig(owner.id);
}

function isValidPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 65_535
  );
}

export function createPreviewConfiguredPortReader(
  application: Pick<DaemonApplication, "localLlmChats" | "managedSessions">
): PreviewConfiguredPortReader {
  return async (owner) => {
    const preview = await readPreviewConfig(application, owner);
    return preview?.active && isValidPort(preview.port) ? preview.port : null;
  };
}

function resolveLoopbackPreviewTargetFromPort(
  port: number | null,
  networkMode: "deskcue-host" | "device-direct" = "device-direct"
) {
  if (!isValidPort(port)) return null;
  return {
    networkMode,
    origin: buildPreviewLoopbackOrigin(port),
    port
  };
}

export function resolveLoopbackPreviewTarget(
  preview: PreviewConfig | null | undefined
): ResolvedPreviewTarget | null {
  if (!preview?.active || !isValidPort(preview.port)) {
    return null;
  }

  // Deliberately ignore persisted targetUrl. A corrupted or older state row
  // must never turn the preview proxy into an arbitrary-network fetcher.
  return resolveLoopbackPreviewTargetFromPort(
    preview.port,
    preview.networkMode ?? "device-direct"
  );
}

export function createPreviewTargetResolver(
  application: Pick<DaemonApplication, "localLlmChats" | "managedSessions">
): PreviewTargetResolver {
  return async (owner) => {
    const preview = await readPreviewConfig(application, owner);
    return resolveLoopbackPreviewTarget(preview);
  };
}
