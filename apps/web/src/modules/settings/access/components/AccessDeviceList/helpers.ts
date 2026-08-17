import type { AccessDeviceSummary } from "@deskcue/protocol";
import {
  formatDeviceIp,
  formatDeviceTitle,
  formatShortDeviceId,
  isLoopbackIp
} from "@modules/settings/access/AccessSettingsTab/deviceLabels";

import type { AccessDeviceGroup, AccessDeviceListProps } from "./types";

export { formatDeviceIp, formatDeviceTitle, formatShortDeviceId, isLoopbackIp };

export function formatDeviceDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatCurrentAccessTitle(currentAccess: AccessDeviceListProps["currentAccess"]) {
  if (currentAccess?.trustedHost) {
    return "Host access";
  }

  return "Not paired";
}

export function formatCurrentAccessDetail(currentAccess: AccessDeviceListProps["currentAccess"]) {
  if (!currentAccess) {
    return "Could not verify the current browser access state.";
  }

  if (currentAccess.trustedHost) {
    return "This local browser is allowed as the host machine, but it is not using a device token.";
  }

  if (currentAccess.credentialPresented) {
    return "This browser sent an access credential, but it did not match an active token. Pair this address again or use a recovery code.";
  }

  if (currentAccess.authRequired) {
    return "No access cookie or token was sent with this request. Active token rows can remain on the host even after a browser loses its local credential.";
  }

  return "Access protection is currently disabled, so this browser is not using a device token.";
}

function isHostAccessDevice(device: AccessDeviceSummary) {
  return Boolean(device.lastIp && isLoopbackIp(device.lastIp));
}

function createAccessDeviceGroupKey(device: AccessDeviceSummary) {
  if (isHostAccessDevice(device)) {
    return "host";
  }

  return [
    device.label,
    device.userAgent ?? "",
    formatDeviceIp(device.lastIp ?? "")
  ].join("|");
}

function readDeviceActivityTime(device: AccessDeviceSummary) {
  const timestamp = new Date(device.lastSeenAt ?? device.createdAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function compareAccessDevicesByActivity(
  left: AccessDeviceSummary,
  right: AccessDeviceSummary
) {
  return readDeviceActivityTime(right) - readDeviceActivityTime(left);
}

export function groupAccessDevices(devices: AccessDeviceSummary[]): AccessDeviceGroup[] {
  const groups = new Map<string, AccessDeviceSummary[]>();

  for (const device of devices) {
    const key = createAccessDeviceGroupKey(device);
    groups.set(key, [...(groups.get(key) ?? []), device]);
  }

  return Array.from(groups.entries())
    .map(([key, groupDevices]) => {
      const sortedDevices = [...groupDevices].sort(compareAccessDevicesByActivity);
      return {
        key,
        devices: sortedDevices,
        host: sortedDevices.some(isHostAccessDevice),
        latestDevice: sortedDevices[0]
      };
    })
    .sort((left, right) => compareAccessDevicesByActivity(left.latestDevice, right.latestDevice));
}

export function formatAccessDeviceGroupTitle(group: AccessDeviceGroup) {
  const title = group.host ? "Local browser tokens" : group.latestDevice.label;
  if (group.devices.length === 1) {
    return title;
  }

  return `${title} (${group.devices.length} active tokens)`;
}

export function isHostAccessDeviceGroup(group: AccessDeviceGroup) {
  return group.host;
}

export function formatAccessDeviceGroupDetail(group: AccessDeviceGroup) {
  const latestDevice = group.latestDevice;
  const parts = [
    latestDevice.lastIp ? formatDeviceIp(latestDevice.lastIp) : null,
    `Last seen ${formatDeviceDate(latestDevice.lastSeenAt ?? latestDevice.createdAt)}`,
    group.devices.length > 1
      ? `Latest token ${formatShortDeviceId(latestDevice.id)}`
      : formatShortDeviceId(latestDevice.id)
  ].filter((part): part is string => Boolean(part));

  return parts.join(" · ");
}
