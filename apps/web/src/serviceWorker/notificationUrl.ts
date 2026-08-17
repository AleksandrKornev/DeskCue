export function readSameOriginNotificationUrl(value: unknown, origin: string) {
  try {
    const url = new URL(typeof value === "string" ? value : "/", origin);
    return url.origin === origin ? url.href : `${origin}/`;
  } catch {
    return `${origin}/`;
  }
}
