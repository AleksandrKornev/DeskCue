
function buildPublicHostOrigins(publicHost: string | null, daemonPort: number) {
  if (!publicHost) {
    return [];
  }

  try {
    const url = publicHost.includes("://")
      ? new URL(publicHost)
      : new URL(`http://${publicHost}`);
    url.pathname = "";
    url.search = "";
    url.hash = "";

    if (!url.port) {
      url.port = String(daemonPort);
    }

    return [url.toString().replace(/\/$/, "")];
  } catch {
    return [];
  }
}export function buildAllowedOrigins(
  configuredOrigins: string[],
  publicHost: string | null,
  pairingHosts: string[],
  daemonPort: number
) {
  const origins = new Set(configuredOrigins);

  for (const origin of buildPublicHostOrigins(publicHost, daemonPort)) {
    origins.add(origin);
  }

  for (const origin of pairingHosts) {
    origins.add(origin);
  }

  return Array.from(origins);
}
