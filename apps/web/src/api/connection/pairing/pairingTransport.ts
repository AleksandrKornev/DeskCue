import type { AccessLinkResponse } from "@deskcue/protocol";

export type AccessLinkTarget = "local" | "device";

const LOCAL_PAIRING_TIMEOUT_MS = 1500;

export class PairingEndpointError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PairingEndpointError";
  }
}

export class AcceptedPairingResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcceptedPairingResponseError";
  }
}

async function readPairingEndpointError(response: Response, timeout: Promise<never>) {
  try {
    const payload = await Promise.race([
      response.json() as Promise<{ error?: unknown }>,
      timeout
    ]);

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
): Promise<unknown> {
  const controller = new AbortController();
  let timeoutId = 0;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      controller.abort();
      reject(new DOMException("DeskCue access request timed out", "AbortError"));
    }, LOCAL_PAIRING_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      fetch(url, {
        body: JSON.stringify(body),
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        method: "POST",
        signal: controller.signal
      }),
      timeout
    ]);

    if (!response.ok) {
      const responseMessage = await readPairingEndpointError(response, timeout);

      throw new PairingEndpointError(responseMessage ?? failureMessage, response.status);
    }

    try {
      return await Promise.race([response.json() as Promise<unknown>, timeout]);
    } catch {
      throw new AcceptedPairingResponseError(failureMessage);
    }
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
