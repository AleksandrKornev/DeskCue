import { useCallback, useEffect, useRef, useState } from "react";

import type { SessionDetail } from "@deskcue/protocol";
import { buildApiUrl } from "@api/connection/config";
import { previewApi } from "@api/endpoint/preview/endpoints";
import type { LiveUpdatesConnectionStatus } from "@models/liveUpdatesConnection";
import { resolvePreviewOwner } from "@models/sessionPreview";

import {
  PREVIEW_TICKET_FALLBACK_REFRESH_MS,
  PREVIEW_TICKET_MAX_AUTO_RETRIES,
  PREVIEW_TICKET_REFRESH_MARGIN_MS,
  PREVIEW_TICKET_RETRY_MS
} from "./constants";
import { createEmptyPreviewTicketState } from "./helpers";
import type { PreviewTicketState } from "./types";

export function usePreviewTicket(
  session: SessionDetail | null,
  enabled: boolean,
  connectionStatus?: LiveUpdatesConnectionStatus
) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [state, setState] = useState<PreviewTicketState>(createEmptyPreviewTicketState);
  const operationRef = useRef(0);
  const retryStateRef = useRef({ failures: 0, key: "" });
  const validationKeyRef = useRef("");
  const hasObservedLiveConnectionRef = useRef(connectionStatus === "live");
  const previousConnectionStatusRef = useRef(connectionStatus);
  const owner = resolvePreviewOwner(session);
  const ownerId = owner?.ownerId ?? "";
  const ownerKind = owner?.kind ?? null;
  const ownerIdentity = ownerKind ? `${ownerKind}:${ownerId}` : "";
  const ownerKey = ownerKind
    ? `${ownerIdentity}:${session?.preview.port ?? ""}:${session?.preview.networkMode ?? "device-direct"}`
    : "";
  const shouldIssueTicket = enabled && owner !== null;

  useEffect(() => {
    const previousStatus = previousConnectionStatusRef.current;

    previousConnectionStatusRef.current = connectionStatus;
    const hadLiveConnection = hasObservedLiveConnectionRef.current;

    if (connectionStatus === "live") hasObservedLiveConnectionRef.current = true;

    if (
      !shouldIssueTicket ||
      connectionStatus !== "live" ||
      !hadLiveConnection ||
      previousStatus === undefined ||
      previousStatus === "live" ||
      state.resolvedKey !== ownerKey
    ) {
      return;
    }

    setRefreshVersion((current) => current + 1);
  }, [connectionStatus, ownerKey, shouldIssueTicket, state.resolvedKey]);

  useEffect(() => {
    if (!ownerKind || !ownerId) {
      operationRef.current += 1;
      retryStateRef.current = { failures: 0, key: "" };
      validationKeyRef.current = "";
      setState(createEmptyPreviewTicketState());
      return;
    }

    if (!enabled) {
      operationRef.current += 1;
      return;
    }

    if (retryStateRef.current.key !== ownerKey) retryStateRef.current = { failures: 0, key: ownerKey };

    const operation = ++operationRef.current;
    const controller = new AbortController();
    const isValidation = validationKeyRef.current === ownerKey;
    let refreshTimer: number | null = null;

    if (isValidation) validationKeyRef.current = "";

    setState((current) => {
      const sameOwner = current.key.startsWith(`${ownerIdentity}:`);

      if (current.key === ownerKey) {
        return {
          ...current,
          error: isValidation ? "" : current.error,
          key: ownerKey,
          loading: isValidation || (!current.url && !current.error)
        };
      }

      if (sameOwner && current.url) {
        return {
          ...current,
          error: "",
          key: ownerKey,
          loading: true
        };
      }

      return {
        ...createEmptyPreviewTicketState(),
        key: ownerKey,
        loading: true
      };
    });

    void previewApi.issueTicket({ kind: ownerKind, ownerId }, controller.signal).then((ticket) => {
      if (operationRef.current !== operation) return;

      retryStateRef.current = { failures: 0, key: ownerKey };
      setState((current) => {
        if (operationRef.current !== operation || current.key !== ownerKey) return current;

        const hasResolvedDocument = Boolean(current.resolvedKey);
        const routingChanged = hasResolvedDocument && current.resolvedKey !== ownerKey;
        const credentialChanged = hasResolvedDocument &&
          current.resolvedCredentialRevision !== ticket.credentialRevision;
        return {
          documentRevision:
            routingChanged || credentialChanged || isValidation
              ? current.documentRevision + 1
              : current.documentRevision,
          error: "",
          key: ownerKey,
          loading: false,
          resolvedCredentialRevision: ticket.credentialRevision,
          resolvedKey: ownerKey,
          url: buildApiUrl(ticket.previewUrl)
        };
      });

      const expiresAtMs = Date.parse(ticket.expiresAt);
      const refreshDelay = Number.isFinite(expiresAtMs)
        ? Math.max(1_000, expiresAtMs - Date.now() - PREVIEW_TICKET_REFRESH_MARGIN_MS)
        : PREVIEW_TICKET_FALLBACK_REFRESH_MS;
      refreshTimer = window.setTimeout(
        () => setRefreshVersion((current) => current + 1),
        refreshDelay
      );
    }).catch((error: unknown) => {
      if (controller.signal.aborted || operationRef.current !== operation) return;

      const failureCount = retryStateRef.current.key === ownerKey
        ? retryStateRef.current.failures + 1
        : 1;
      retryStateRef.current = { failures: failureCount, key: ownerKey };

      setState((current) => {
        if (operationRef.current !== operation || current.key !== ownerKey) return current;

        if (!isValidation && current.url && current.resolvedKey === ownerKey) {
          return {
            ...current,
            error: "",
            loading: false
          };
        }

        return {
          ...current,
          error: error instanceof Error ? error.message : "Failed to open the local preview",
          key: ownerKey,
          loading: false,
          url: null
        };
      });
      if (failureCount <= PREVIEW_TICKET_MAX_AUTO_RETRIES) {
        refreshTimer = window.setTimeout(
          () => setRefreshVersion((current) => current + 1),
          PREVIEW_TICKET_RETRY_MS
        );
      }
    });

    return () => {
      controller.abort();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [enabled, ownerId, ownerIdentity, ownerKey, ownerKind, refreshVersion]);

  const retry = useCallback(() => {
    retryStateRef.current = { failures: 0, key: ownerKey };
    setState((current) => current.key === ownerKey && current.error
      ? { ...current, error: "", loading: true }
      : current);
    setRefreshVersion((current) => current + 1);
  }, [ownerKey]);

  const validate = useCallback(() => {
    retryStateRef.current = { failures: 0, key: ownerKey };
    validationKeyRef.current = ownerKey;
    setState((current) => current.key === ownerKey
      ? { ...current, error: "", loading: true }
      : current);
    setRefreshVersion((current) => current + 1);
  }, [ownerKey]);
  const hasVisibleOwnerState = Boolean(ownerIdentity) &&
    state.key.startsWith(`${ownerIdentity}:`);

  return {
    documentRevision: hasVisibleOwnerState ? state.documentRevision : 0,
    error: state.key === ownerKey ? state.error : "",
    loading: state.key === ownerKey && state.loading,
    retry,
    validate,
    url: hasVisibleOwnerState ? state.url : null
  };
}
