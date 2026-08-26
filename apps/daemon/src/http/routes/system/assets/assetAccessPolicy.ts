import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentSessionDetail, CreateAssetTicketInput } from "@deskcue/protocol";
import { waitForPendingGeneratedImage } from "#agents/codex/transcript/parsing/entries/codexTranscriptGeneratedImages";
import type { ManagedSessionService } from "#application/managedSessionService";
import type { SourceAgentSessionService } from "#application/sourceAgentSessionService";
import { daemonConfig } from "#config/daemonConfig";

const LOCAL_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg"
]);

export type AssetRequestContext = Pick<
  CreateAssetTicketInput,
  "agentSessionId" | "managedSessionId" | "workspaceId"
>;

export type AssetPolicyError = {
  message: string;
  statusCode: 400 | 403 | 404;
};

export type AssetAuthorization =
  | { error: null; path: string }
  | { error: AssetPolicyError; path: null };

type AssetAccessPolicyOptions = {
  managedSessions?: ManagedSessionService;
  sourceAgentSessions?: SourceAgentSessionService;
  trustedFileRoots?: string[];
  trustedImageRoots?: string[];
  listWorkspaces: () => Array<{ id?: string; path: string }>;
};

function normalizeComparablePath(assetPath: string) {
  return path.resolve(path.normalize(assetPath)).toLowerCase();
}

function hasTranscriptAttachmentPath(session: AgentSessionDetail, normalizedPath: string) {
  const expectedPath = normalizeComparablePath(normalizedPath);

  return session.transcript.some((entry) =>
    entry.parts?.some((part) =>
      part.type === "attachment" &&
      part.path &&
      normalizeComparablePath(part.path) === expectedPath
    )
  );
}

function denied(error: AssetPolicyError): AssetAuthorization {
  return { error, path: null };
}

function deniedTicketAccess(kind: "file" | "local_image"): AssetAuthorization {
  return denied(kind === "file"
    ? {
        statusCode: 403,
        message: "Local assets are only available from registered workspaces, trusted generated artifact roots, or transcript attachments."
      }
    : {
        statusCode: 403,
        message: "Local images are only available from registered workspaces, trusted temporary directories, or transcript attachments."
      });
}

function deniedImageAccess(): AssetAuthorization {
  return denied({
    statusCode: 403,
    message: "Local images are only available from registered workspaces or trusted temporary directories."
  });
}

async function canonicalizeAssetPath(assetPath: string) {
  try {
    return await realpath(assetPath);
  } catch {
    return null;
  }
}

async function isInsideAnyCanonicalRoot(assetPath: string, roots: string[]) {
  const canonicalRoots = await Promise.all(roots.map(canonicalizeAssetPath));

  return canonicalRoots.some((root) => {
    if (!root) return false;

    const relativePath = path.relative(root, assetPath);

    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
  });
}

function assetNotFound(): AssetAuthorization {
  return denied({
    statusCode: 404,
    message: "Local asset not found."
  });
}

function deniedFileAccess(): AssetAuthorization {
  return denied({
    statusCode: 403,
    message: "Local assets are only available from registered workspaces or trusted generated artifact roots."
  });
}

function isInsideRoot(assetPath: string, root: string) {
  const relativePath = path.relative(root, assetPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isInsideAnyRoot(assetPath: string, roots: string[]) {
  return roots.some((root) => isInsideRoot(assetPath, path.resolve(root)));
}

export class AssetAccessPolicy {
  constructor(private readonly options: AssetAccessPolicyOptions) {}

  async resolveWorkspacePath(workspaceId: string, assetPath: string): Promise<AssetAuthorization> {
    const workspace = this.options.listWorkspaces().find((candidate) => candidate.id === workspaceId);

    if (!workspace) return denied({ statusCode: 404, message: "Workspace not found." });

    if (!assetPath || path.isAbsolute(assetPath)) {
      return denied({ statusCode: 400, message: "Workspace asset path must be relative." });
    }

    const rootPath = path.resolve(workspace.path);
    const resolvedPath = path.resolve(rootPath, assetPath);

    if (!isInsideRoot(resolvedPath, rootPath)) {
      return denied({ statusCode: 403, message: "Workspace asset path escapes its registered workspace." });
    }

    const [canonicalRoot, canonicalPath] = await Promise.all([
      canonicalizeAssetPath(rootPath),
      canonicalizeAssetPath(resolvedPath)
    ]);

    if (!canonicalRoot || !canonicalPath) return assetNotFound();

    if (!isInsideRoot(canonicalPath, canonicalRoot)) {
      return denied({ statusCode: 403, message: "Workspace asset path escapes its registered workspace." });
    }

    return { error: null, path: canonicalPath };
  }

  normalizePath(assetPath: string) {
    if (!assetPath) return null;

    const normalizedPath = path.normalize(assetPath);

    return path.isAbsolute(normalizedPath) ? normalizedPath : null;
  }

  async authorizeFile(normalizedPath: string): Promise<AssetAuthorization> {
    const roots = this.readConfiguredRoots(this.readTrustedFileRoots());

    if (!isInsideAnyRoot(normalizedPath, roots)) return deniedFileAccess();

    await waitForPendingGeneratedImage(normalizedPath);
    const canonicalPath = await canonicalizeAssetPath(normalizedPath);

    if (!canonicalPath) return assetNotFound();
    if (await isInsideAnyCanonicalRoot(canonicalPath, roots)) return { error: null, path: canonicalPath };

    return deniedFileAccess();
  }

  async authorizeImage(normalizedPath: string): Promise<AssetAuthorization> {
    const roots = this.readConfiguredRoots(this.readTrustedImageRoots());

    if (!isInsideAnyRoot(normalizedPath, roots)) return deniedImageAccess();

    await waitForPendingGeneratedImage(normalizedPath);
    const canonicalPath = await canonicalizeAssetPath(normalizedPath);

    if (!canonicalPath) return assetNotFound();
    if (!(await isInsideAnyCanonicalRoot(canonicalPath, roots))) return deniedImageAccess();

    const typeError = this.readImageTypeError(canonicalPath);

    return typeError ? denied(typeError) : { error: null, path: canonicalPath };
  }

  async authorizeTicket(
    kind: "file" | "local_image",
    normalizedPath: string,
    requestContext: AssetRequestContext
  ): Promise<AssetAuthorization> {
    if (requestContext.workspaceId) {
      return this.authorizeWorkspaceTicket(kind, normalizedPath, requestContext.workspaceId);
    }

    const trustedRoots = kind === "file"
      ? this.readTrustedFileRoots()
      : this.readTrustedImageRoots();
    const roots = this.readConfiguredRoots(trustedRoots);
    const isRootCandidate = isInsideAnyRoot(normalizedPath, roots);
    const isTranscriptAttachment = await this.isTranscriptAttachmentPath(
      normalizedPath,
      requestContext
    );

    if (!isRootCandidate && !isTranscriptAttachment) return deniedTicketAccess(kind);

    await waitForPendingGeneratedImage(normalizedPath);
    const canonicalPath = await canonicalizeAssetPath(normalizedPath);

    if (!canonicalPath) return assetNotFound();

    const isAllowed =
      isTranscriptAttachment ||
      (isRootCandidate && await isInsideAnyCanonicalRoot(canonicalPath, roots));
    if (!isAllowed) return deniedTicketAccess(kind);

    const typeError = kind === "local_image" ? this.readImageTypeError(canonicalPath) : null;

    return typeError ? denied(typeError) : { error: null, path: canonicalPath };
  }

  private async authorizeWorkspaceTicket(
    kind: "file" | "local_image",
    normalizedPath: string,
    workspaceId: string
  ): Promise<AssetAuthorization> {
    const workspace = this.options.listWorkspaces().find((candidate) => candidate.id === workspaceId);

    if (!workspace) return denied({ statusCode: 404, message: "Workspace not found." });

    await waitForPendingGeneratedImage(normalizedPath);
    const [canonicalRoot, canonicalPath] = await Promise.all([
      canonicalizeAssetPath(path.resolve(workspace.path)),
      canonicalizeAssetPath(normalizedPath)
    ]);

    if (!canonicalRoot || !canonicalPath) return assetNotFound();

    if (!isInsideRoot(canonicalPath, canonicalRoot)) {
      return denied({ statusCode: 403, message: "Workspace asset path escapes its registered workspace." });
    }

    const typeError = kind === "local_image" ? this.readImageTypeError(canonicalPath) : null;

    return typeError ? denied(typeError) : { error: null, path: canonicalPath };
  }

  private readConfiguredRoots(trustedRoots: string[]) {
    return [
      ...this.options.listWorkspaces().map((workspace) => workspace.path),
      ...trustedRoots
    ];
  }

  private async isTranscriptAttachmentPath(
    normalizedPath: string,
    requestContext: AssetRequestContext
  ) {
    if (!this.options.sourceAgentSessions) return false;

    const agentSessionId =
      requestContext.agentSessionId ??
      this.resolveAgentSessionIdFromManagedSession(requestContext.managedSessionId);
    if (!agentSessionId) return false;

    const session = await this.options.sourceAgentSessions.getSessionDetail(agentSessionId);

    return session ? hasTranscriptAttachmentPath(session, normalizedPath) : false;
  }

  private resolveAgentSessionIdFromManagedSession(managedSessionId: string | undefined) {
    if (!managedSessionId || !this.options.managedSessions) return null;

    const session = this.options.managedSessions.getSession(managedSessionId);

    if (!session?.sourceSessionId) return null;

    return `${session.adapterId}:${session.sourceSessionId}`;
  }

  private readImageTypeError(normalizedPath: string): AssetPolicyError | null {
    if (LOCAL_IMAGE_EXTENSIONS.has(path.extname(normalizedPath).toLowerCase())) return null;

    return {
      statusCode: 400,
      message: "Unsupported local image type."
    };
  }

  private readTrustedFileRoots() {
    return this.options.trustedFileRoots ?? [
      daemonConfig.agentDataRoots.codexHome,
      daemonConfig.agentDataRoots.claudeHome,
      daemonConfig.agentDataRoots.lmStudioHome
    ];
  }

  private readTrustedImageRoots() {
    return this.options.trustedImageRoots ?? [
      os.tmpdir(),
      daemonConfig.agentDataRoots.codexHome,
      daemonConfig.agentDataRoots.claudeHome,
      daemonConfig.agentDataRoots.lmStudioHome
    ];
  }
}
