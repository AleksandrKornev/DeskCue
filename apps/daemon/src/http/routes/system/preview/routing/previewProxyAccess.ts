import { accessDeviceStore } from "#access/accessDevices";
import { daemonConfig } from "#config/daemonConfig";

export function isDeskCueAccessToken(value: string) {
  return Boolean(accessDeviceStore.authenticateToken(value));
}

export function readPreviewAuthRequired(authRequired?: () => boolean) {
  return authRequired?.() ?? daemonConfig.authRequired;
}
