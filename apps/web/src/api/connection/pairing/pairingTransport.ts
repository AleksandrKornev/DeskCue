import type { AccessLinkResponse } from "@deskcue/protocol";

export type AccessLinkTarget = "local" | "device";

const LOCAL_PAIRING_TIMEOUT_MS = 1500;

export class PairingEndpointError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PairingEndpointError";
  }
}

async function readPairingEndpointError(response: Response) {
  try {
    const payload = await response.json() as { error?: unknown };

    return typeof payload.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : null;
  } catch {
    return null;
  }
}

export async function fetchPairingEndpoint(
  url: string,
  body: Record<string, string>,
  failureMessage: string
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, LOCAL_PAIRING_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      body: JSON.stringify(body),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });

    if (!response.ok) {
      const responseMessage = await readPairingEndpointError(response);

      throw new PairingEndpointError(responseMessage ?? failureMessage, response.status);
    }

    return response;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchLocalAccessLink(daemonUrl: string, target: AccessLinkTarget) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, LOCAL_PAIRING_TIMEOUT_MS);

  try {
    const url = new URL(`${daemonUrl}/api/access/link`);

    if (target === "device") url.searchParams.set("target", "device");

    const response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal
    });

    if (!response.ok) return null;

    return (await response.json()) as AccessLinkResponse;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
