import {
  useCallback,
  useEffect,
  useState
} from "react";

import {
  assetsApi,
  LOCAL_ASSET_TEXT_PREVIEW_MAX_BYTES
} from "@api/endpoint/assets/endpoints";
import type { LocalAssetLinkContext } from "@api/endpoint/assets/types";
import {
  getLocalAssetPreviewKind,
  shouldProbeLocalAssetAsText
} from "@modules/transcript/RichTranscriptContent/model/attachments";
import type { AttachmentPreviewKind } from "@modules/transcript/RichTranscriptContent/types";

const LOCAL_ASSET_DOCUMENT_PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

type LocalAssetPreviewFailure = "decode" | "load" | "too_large";

type LocalAssetPreviewImage = {
  alt: string;
  url: string;
};

export type LocalAssetPreviewState = {
  failure: LocalAssetPreviewFailure | null;
  kind: AttachmentPreviewKind;
  status: "error" | "loading" | "ready" | "unsupported";
  text: string;
  url: string | null;
};

type UseLocalAssetPreviewOptions = {
  assetContext?: LocalAssetLinkContext;
  assetPath: string;
  displayName: string;
  isOpen: boolean;
  previewImage?: LocalAssetPreviewImage;
  previewStatus?: "error" | "loading" | "ready";
};

type LoadLocalAssetPreviewOptions = {
  assetContext?: LocalAssetLinkContext;
  assetPath: string;
  displayName: string;
  kind: AttachmentPreviewKind;
  signal: AbortSignal;
};

type LoadedLocalAssetPreview = {
  revokeUrl: boolean;
  text: string;
  url: string | null;
};

function getEffectiveLocalAssetPreviewKind(assetPath: string) {
  const classifiedKind = getLocalAssetPreviewKind(assetPath);

  if (classifiedKind !== "none") return classifiedKind;

  return shouldProbeLocalAssetAsText(assetPath) ? "text" : "none";
}

function createInitialPreviewState(assetPath: string): LocalAssetPreviewState {
  const kind = getEffectiveLocalAssetPreviewKind(assetPath);

  if (kind === "none") {
    return { failure: null, kind, status: "unsupported", text: "", url: null };
  }

  return { failure: null, kind, status: "loading", text: "", url: null };
}

function hasSessionAssetScope(context?: LocalAssetLinkContext) {
  return Boolean(context?.agentSessionId || context?.managedSessionId);
}

async function resolveLocalAssetMediaUrl(
  assetPath: string,
  assetContext: LocalAssetLinkContext | undefined,
  signal: AbortSignal
) {
  if (hasSessionAssetScope(assetContext)) {
    signal.throwIfAborted();

    return assetsApi.buildFileUrl(assetPath, { context: assetContext });
  }

  const ticket = await assetsApi.createLocalAssetLink(assetPath, {
    context: assetContext,
    signal
  });

  signal.throwIfAborted();

  return ticket.url;
}

function isCompatiblePreviewMime(kind: AttachmentPreviewKind, mimeType: string) {
  const normalizedMime = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";

  if (kind === "image") return normalizedMime.startsWith("image/");
  if (kind === "pdf") return normalizedMime === "application/pdf";

  return true;
}

function readTextEncoding(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";

  return "utf-8";
}

function decodePreviewText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const encoding = readTextEncoding(bytes);
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "");

  if (text.includes("\u0000")) throw new Error("Asset is not plain text.");

  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAllowedControl = character === "\n" || character === "\r" || character === "\t";

    const isRejectedControl = (codePoint < 0x20 && !isAllowedControl) ||
      (codePoint >= 0x7f && codePoint <= 0x9f);

    if (isRejectedControl) throw new Error("Asset is not plain text.");
  }

  return text;
}

function getPreviewFailure(error: unknown): LocalAssetPreviewFailure {
  if (error instanceof Error && /exceeds|too large|byte limit/iu.test(error.message)) {
    return "too_large";
  }

  if (error instanceof TypeError || error instanceof RangeError) return "decode";
  if (error instanceof Error && error.message === "Asset is not plain text.") return "decode";

  return "load";
}

async function loadLocalAssetPreview({
  assetContext,
  assetPath,
  displayName,
  kind,
  signal
}: LoadLocalAssetPreviewOptions): Promise<LoadedLocalAssetPreview> {
  if (kind === "audio" || kind === "video") {
    const url = await resolveLocalAssetMediaUrl(assetPath, assetContext, signal);

    return { revokeUrl: false, text: "", url };
  }

  const maximumBytes = kind === "text"
    ? LOCAL_ASSET_TEXT_PREVIEW_MAX_BYTES
    : LOCAL_ASSET_DOCUMENT_PREVIEW_MAX_BYTES;
  const blob = await assetsApi.getTicketBlob(assetPath, displayName, {
    context: assetContext,
    kind: kind === "image" ? "local_image" : "file",
    maxBytes: maximumBytes,
    signal
  });

  if (!isCompatiblePreviewMime(kind, blob.type)) {
    throw new TypeError("Asset content type does not match its preview type.");
  }

  if (kind === "text") {
    return {
      revokeUrl: false,
      text: decodePreviewText(await blob.arrayBuffer()),
      url: null
    };
  }

  return {
    revokeUrl: true,
    text: "",
    url: URL.createObjectURL(blob)
  };
}

export function useLocalAssetPreview({
  assetContext,
  assetPath,
  displayName,
  isOpen,
  previewImage,
  previewStatus
}: UseLocalAssetPreviewOptions) {
  const agentSessionId = assetContext?.agentSessionId;
  const managedSessionId = assetContext?.managedSessionId;
  const workspaceId = assetContext?.workspaceId;
  const previewImageUrl = previewImage?.url;
  const [retryRevision, setRetryRevision] = useState(0);
  const [preview, setPreview] = useState<LocalAssetPreviewState>(
    () => createInitialPreviewState(assetPath)
  );
  const kind = getEffectiveLocalAssetPreviewKind(assetPath);

  useEffect(() => {
    if (!isOpen) return;

    if (kind === "none") {
      setPreview({ failure: null, kind, status: "unsupported", text: "", url: null });
      return;
    }

    if (kind === "image" && previewStatus) {
      const hasReadyImage = previewStatus === "ready" && Boolean(previewImageUrl);

      setPreview({
        failure: previewStatus === "error" || (previewStatus === "ready" && !hasReadyImage)
          ? "decode"
          : null,
        kind,
        status: previewStatus === "ready" ? (hasReadyImage ? "ready" : "error") : previewStatus,
        text: "",
        url: hasReadyImage ? previewImageUrl ?? null : null
      });
      return;
    }

    let objectUrl: string | null = null;
    let settled = false;
    const requestController = new AbortController();
    const previewContext = agentSessionId || managedSessionId || workspaceId
      ? { agentSessionId, managedSessionId, workspaceId }
      : undefined;

    setPreview({ failure: null, kind, status: "loading", text: "", url: null });

    void loadLocalAssetPreview({
      assetContext: previewContext,
      assetPath,
      displayName,
      kind,
      signal: requestController.signal
    })
      .then(({ revokeUrl, text, url }) => {
        if (settled) {
          if (revokeUrl && url) URL.revokeObjectURL(url);
          return;
        }

        objectUrl = revokeUrl ? url : null;

        setPreview({ failure: null, kind, status: "ready", text, url });
      })
      .catch((error: unknown) => {
        if (settled || requestController.signal.aborted) return;

        setPreview({
          failure: getPreviewFailure(error),
          kind,
          status: "error",
          text: "",
          url: null
        });
      });

    return () => {
      settled = true;
      requestController.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    agentSessionId,
    assetPath,
    displayName,
    isOpen,
    kind,
    managedSessionId,
    previewImageUrl,
    previewStatus,
    retryRevision,
    workspaceId
  ]);

  const markPreviewFailed = useCallback(() => {
    setPreview((current) => ({ ...current, failure: "decode", status: "error", url: null }));
  }, []);

  const retryPreview = useCallback(() => {
    setRetryRevision((current) => current + 1);
  }, []);

  return { markPreviewFailed, preview, retryPreview };
}
