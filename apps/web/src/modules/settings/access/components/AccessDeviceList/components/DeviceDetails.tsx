import type { AccessDeviceSummary } from "@deskcue/protocol";
import {
  formatDeviceDate,
  formatDeviceIp,
  formatShortDeviceId
} from "@modules/settings/access/components/AccessDeviceList/helpers";

export type DeviceDetailsProps = {
  device: AccessDeviceSummary;
};

export function DeviceDetails({ device }: DeviceDetailsProps) {
  return (
    <small>
      {device.lastIp ? `${formatDeviceIp(device.lastIp)} · ` : ""}
      Last seen {formatDeviceDate(device.lastSeenAt ?? device.createdAt)}
      {" · "}
      {formatShortDeviceId(device.id)}
    </small>
  );
}
