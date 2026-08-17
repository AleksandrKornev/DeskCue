import type { AccessDeviceSummary } from "@deskcue/protocol";

export function formatDeviceIp(value: string) {
  return value.replace(/^::ffff:/, "");
}

export function isLoopbackIp(value: string) {
  const normalized = formatDeviceIp(value);
  return normalized === "127.0.0.1" || normalized === "::1";
}

export function formatDeviceTitle(device: AccessDeviceSummary) {
  if (device.current) return `This browser (${device.label})`;
  if (device.lastIp && isLoopbackIp(device.lastIp)) return `Host ${device.label}`;
  if (device.lastIp) return `${device.label} on ${formatDeviceIp(device.lastIp)}`;
  return device.label;
}

export function formatShortDeviceId(value: string) {
  return `id ${value.slice(0, 8)}`;
}
