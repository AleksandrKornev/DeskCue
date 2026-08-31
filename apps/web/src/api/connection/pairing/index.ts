import type { PairAccessResponse } from "@deskcue/protocol";
import { getConnectionConfig, saveConnectionConfig } from "@api/connection/configStorage";
import {
  collectNormalizedDaemonUrls,
  collectNormalizedTokens,
  isSameOriginDaemonUrl,
  normalizeDaemonUrl,
  readFirstNormalizedDaemonUrl,
  readFirstNormalizedToken
} from "@api/connection/configUrls";

import {
  buildLocalAccessLinkCandidates,
  buildPairingDaemonUrlCandidates
} from "./pairingCandidates";
import {
  AcceptedPairingResponseError,
  fetchLocalAccessLink,
  fetchPairingEndpoint,
  PairingEndpointError
} from "./pairingTransport";
import type { AccessLinkTarget } from "./pairingTransport";
import {
  clearPairingQueryParams,
  readPairCodeFromPath,
  readRecoveryCodeFromPath
} from "./pairingUrlCodes";

export type ConnectionPreparationFailure = {
  message: string;
  requestAccepted: boolean;
  retryOriginal: boolean;
  title: string;
};

type AcceptedConnectionPreparation = {
  daemonUrl: string;
  payload: unknown;
};

class AcceptedConnectionPreparationError extends Error {
  constructor(readonly operation: "pair" | "recover") {
    super(`DeskCue accepted the ${operation} request, but the browser could not save access`);
    this.name = "AcceptedConnectionPreparationError";
  }
}

function readPairAccessResponse(value: unknown): PairAccessResponse {
  if (!value || typeof value !== "object") {
    throw new Error("DeskCue returned an invalid access response");
  }

  const payload = value as Record<string, unknown>;
  const accessToken = typeof payload.accessToken === "string"
    ? payload.accessToken.trim()
    : "";
  const daemonUrl = typeof payload.daemonUrl === "string"
    ? normalizeDaemonUrl(payload.daemonUrl)
    : null;
  const deviceId = typeof payload.deviceId === "string"
    ? payload.deviceId.trim()
    : "";

  if (!accessToken || !daemonUrl || !deviceId) {
    throw new Error("DeskCue returned an invalid access response");
  }

  return { accessToken, daemonUrl, deviceId };
}

let pairingPromise: Promise<void> | null = null;
let connectionPreparationFailure: ConnectionPreparationFailure | null = null;

function buildUnknownOutcomeFailureMessage(operation: "pair" | "recover") {
  return operation === "pair"
    ? "DeskCue could not confirm whether this pairing request was applied. The original code " +
      "will not be sent again. Check DeskCue access, then create a fresh device link if needed."
    : "DeskCue could not confirm whether this recovery request was applied. The original code " +
      "will not be sent again. Check DeskCue access, then create a fresh recovery code if needed.";
}

function buildRejectedFailureMessage(operation: "pair" | "recover") {
  return operation === "pair"
    ? "DeskCue could not accept this pairing link. Create a fresh device link in " +
      "Settings → Connections."
    : "DeskCue could not accept this recovery code. Create a fresh recovery code in " +
      "Settings → Connections.";
}

function hasInvalidExplicitDaemonUrl(values: Array<string | null>) {
  return values.some((value) => Boolean(value?.trim()) && !normalizeDaemonUrl(value));
}

function hasAmbiguousConnectionPreparationUrl() {
  const query = new URLSearchParams(window.location.search);
  const pairCodes = collectNormalizedTokens([
    ...query.getAll("deskcuePair"),
    ...query.getAll("pair"),
    readPairCodeFromPath(window.location.pathname)
  ]);
  const recoveryCodes = collectNormalizedTokens([
    ...query.getAll("deskcueRecovery"),
    ...query.getAll("recovery"),
    readRecoveryCodeFromPath(window.location.pathname)
  ]);
  const daemonUrlValues = [
    ...query.getAll("deskcueDaemon"),
    ...query.getAll("daemon")
  ];
  const daemonUrls = collectNormalizedDaemonUrls(daemonUrlValues);

  return pairCodes.size > 1 || recoveryCodes.size > 1 ||
    daemonUrls.size > 1 || hasInvalidExplicitDaemonUrl(daemonUrlValues) ||
    (pairCodes.size > 0 && recoveryCodes.size > 0);
}

function buildAmbiguousConnectionPreparationFailure(): ConnectionPreparationFailure {
  return {
    message: "This URL contains conflicting pairing, recovery, or DeskCue address values. " +
      "Create and open a single fresh link from Settings → Connections.",
    requestAccepted: false,
    retryOriginal: false,
    title: "One-time link is ambiguous"
  };
}

function buildConnectionPreparationFailure(
  error: unknown,
  operation: "pair" | "recover"
): ConnectionPreparationFailure {
  if (error instanceof AcceptedConnectionPreparationError) {
    return {
      message: operation === "pair"
        ? "DeskCue accepted this pairing request, but the browser could not finish saving access. " +
          "Check DeskCue access. If access is still unavailable, create a fresh device link."
        : "DeskCue accepted this recovery request, but the browser could not finish saving access. " +
          "Check DeskCue access. If access is still unavailable, create a fresh recovery code.",
      requestAccepted: true,
      retryOriginal: false,
      title: "DeskCue access needs checking"
    };
  }

  if (error instanceof PairingEndpointError && error.status === 429) {
    return {
      message: "Wait a moment before trying again, then create a fresh link or recovery code.",
      requestAccepted: false,
      retryOriginal: false,
      title: "Too many access attempts"
    };
  }

  if (error instanceof PairingEndpointError && error.status === 401) {
    return operation === "pair"
      ? {
        message: "This pairing link is invalid, expired, or already used. " +
          "Create a fresh device link in Settings → Connections.",
        requestAccepted: false,
        retryOriginal: false,
        title: "Pairing link did not work"
      }

      : {
        message: "This recovery code is invalid, expired, or already used. " +
          "Create a fresh recovery code in Settings → Connections.",
        requestAccepted: false,
        retryOriginal: false,
        title: "Recovery code did not work"
      };
  }

  return operation === "pair"
    ? {
      message: error instanceof PairingEndpointError
        ? buildRejectedFailureMessage(operation)
        : buildUnknownOutcomeFailureMessage(operation),
      requestAccepted: false,
      retryOriginal: false,
      title: "Pairing link did not work"
    }

    : {
      message: error instanceof PairingEndpointError
        ? buildRejectedFailureMessage(operation)
        : buildUnknownOutcomeFailureMessage(operation),
      requestAccepted: false,
      retryOriginal: false,
      title: "Recovery code did not work"
    };
}

export function readConnectionPreparationFailure() {
  return connectionPreparationFailure;
}

export function clearConnectionPreparationFailure() {
  connectionPreparationFailure = null;
}

function saveAcceptedConnectionPreparation(
  accepted: AcceptedConnectionPreparation,
  operation: "pair" | "recover"
) {
  try {
    const payload = readPairAccessResponse(accepted.payload);

    saveConnectionConfig({
      accessToken: null,
      deviceId: payload.deviceId,
      daemonUrl: isSameOriginDaemonUrl(accepted.daemonUrl)
        ? accepted.daemonUrl
        : payload.daemonUrl
    });
  } catch {
    throw new AcceptedConnectionPreparationError(operation);
  }
}

async function fetchConnectionPreparationFromDaemon(
  daemonUrl: string,
  code: string,
  operation: "pair" | "recover"
): Promise<AcceptedConnectionPreparation> {
  const endpoint = operation === "pair" ? "pair" : "recover";
  const failureMessage = operation === "pair"
    ? "Unable to pair this DeskCue client"
    : "Unable to recover this DeskCue client";

  try {
    const payload = await fetchPairingEndpoint(
      `${daemonUrl}/api/access/${endpoint}`,
      { code },
      failureMessage
    );

    return { daemonUrl, payload };
  } catch (error) {
    if (error instanceof AcceptedPairingResponseError) {
      throw new AcceptedConnectionPreparationError(operation);
    }

    throw error;
  }
}

async function pairWithDaemon(daemonUrl: string, pairCode: string) {
  const accepted = await fetchConnectionPreparationFromDaemon(daemonUrl, pairCode, "pair");

  saveAcceptedConnectionPreparation(accepted, "pair");
}

async function fetchConnectionPreparationFromSelectedDaemon(
  daemonUrls: string[],
  code: string,
  operation: "pair" | "recover"
) {
  const [daemonUrl] = daemonUrls;
  const failureMessage = operation === "pair"
    ? "Unable to pair this DeskCue client"
    : "Unable to recover this DeskCue client";

  if (!daemonUrl) throw new Error(failureMessage);

  return fetchConnectionPreparationFromDaemon(daemonUrl, code, operation);
}

async function recoverWithSelectedDaemon(daemonUrls: string[], recoveryCode: string) {
  const accepted = await fetchConnectionPreparationFromSelectedDaemon(
    daemonUrls,
    recoveryCode,
    "recover"
  );

  saveAcceptedConnectionPreparation(accepted, "recover");
}

async function pairWithSelectedDaemon(daemonUrls: string[], pairCode: string) {
  const accepted = await fetchConnectionPreparationFromSelectedDaemon(daemonUrls, pairCode, "pair");

  saveAcceptedConnectionPreparation(accepted, "pair");
}

async function recoverFromUrlIfNeeded() {
  const query = new URLSearchParams(window.location.search);
  const recoveryCode = readFirstNormalizedToken([
    ...query.getAll("deskcueRecovery"),
    ...query.getAll("recovery"),
    readRecoveryCodeFromPath(window.location.pathname)
  ]);
  const queryDaemonUrl = readFirstNormalizedDaemonUrl([
    ...query.getAll("deskcueDaemon"),
    ...query.getAll("daemon")
  ]);

  if (!recoveryCode) return;

  clearPairingQueryParams();
  clearConnectionPreparationFailure();

  try {
    await recoverWithSelectedDaemon(buildPairingDaemonUrlCandidates(queryDaemonUrl), recoveryCode);
  } catch (error) {
    connectionPreparationFailure = buildConnectionPreparationFailure(error, "recover");
    throw error;
  }

}

async function pairFromUrlIfNeeded() {
  const query = new URLSearchParams(window.location.search);
  const pairCode = readFirstNormalizedToken([
    ...query.getAll("deskcuePair"),
    ...query.getAll("pair"),
    readPairCodeFromPath(window.location.pathname)
  ]);
  const queryDaemonUrl = readFirstNormalizedDaemonUrl([
    ...query.getAll("deskcueDaemon"),
    ...query.getAll("daemon")
  ]);

  if (!pairCode) return;

  clearPairingQueryParams();
  clearConnectionPreparationFailure();

  try {
    await pairWithSelectedDaemon(buildPairingDaemonUrlCandidates(queryDaemonUrl), pairCode);
  } catch (error) {
    connectionPreparationFailure = buildConnectionPreparationFailure(error, "pair");
    throw error;
  }

}

async function preparePairing() {
  if (hasAmbiguousConnectionPreparationUrl()) {
    clearPairingQueryParams();
    connectionPreparationFailure = buildAmbiguousConnectionPreparationFailure();
    throw new Error("Ambiguous DeskCue pairing or recovery URL");
  }

  await recoverFromUrlIfNeeded();
  await pairFromUrlIfNeeded();
}

export function prepareConnectionConfig() {
  if (!pairingPromise) {
    const request = preparePairing().catch((error) => {
      if (pairingPromise === request) pairingPromise = null;
      throw error;
    });

    pairingPromise = request;
  }

  return pairingPromise;
}

export async function createLocalAccessLink(target: AccessLinkTarget = "local") {
  for (const daemonUrl of buildLocalAccessLinkCandidates()) {
    const link = await fetchLocalAccessLink(daemonUrl, target);

    if (link) return link;
  }

  return null;
}

export async function ensureLocalAccessToken() {
  const currentConfig = getConnectionConfig();

  if ((currentConfig.accessToken || currentConfig.deviceId) && currentConfig.daemonUrl) return currentConfig;

  const link = await createLocalAccessLink();

  if (!link) return null;

  await pairWithDaemon(normalizeDaemonUrl(link.daemonUrl) ?? currentConfig.daemonUrl, link.pairCode);
  return getConnectionConfig();
}
