import { randomBytes, timingSafeEqual } from "node:crypto";

const CLOUD_PROCESS_LOCAL_AUTH_SCHEME = "DeskCueCloudInternal";
const cloudProcessLocalToken = randomBytes(32).toString("base64url");

/** Returns the authorization value shared only inside this daemon process. */
export function createCloudProcessLocalAuthorization(): string {
  return `${CLOUD_PROCESS_LOCAL_AUTH_SCHEME} ${cloudProcessLocalToken}`;
}

/** Validates the process-local credential without exposing its token. */
export function isValidCloudProcessLocalAuthorization(
  authorization: string | undefined
): boolean {
  if (!authorization?.startsWith(`${CLOUD_PROCESS_LOCAL_AUTH_SCHEME} `)) return false;

  const suppliedToken = authorization
    .slice(CLOUD_PROCESS_LOCAL_AUTH_SCHEME.length + 1)
    .trim();
  const expected = Buffer.from(cloudProcessLocalToken, "utf8");
  const supplied = Buffer.from(suppliedToken, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
