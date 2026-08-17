import type {
  AccessDevicesResponse,
  AccessLinkResponse,
  AccessLinkStatusResponse,
  CreateAccessRecoveryCodeResponse,
  DaemonSettingsResponse,
  RevokeAccessDevicesResponse,
  SecurityStatusResponse,
  UpdateAccessDeviceResponse,
  UpdateDaemonSettingsInput
} from "@deskcue/protocol";
import {
  deleteApi,
  getJson,
  patchApi,
  postApi
} from "@api/transport/requests";

export const accessApi = {
  getSecurityStatus() {
    return getJson<SecurityStatusResponse>(
      "/api/security/status",
      "Failed to load daemon security status"
    );
  },

  getDaemonSettings() {
    return getJson<DaemonSettingsResponse>(
      "/api/security/settings",
      "Failed to load daemon settings"
    );
  },

  updateDaemonSettings(input: UpdateDaemonSettingsInput) {
    return patchApi<DaemonSettingsResponse>("/api/security/settings", input);
  },

  resetDaemonSettings() {
    return deleteApi<DaemonSettingsResponse>("/api/security/settings");
  },

  getDevices() {
    return getJson<AccessDevicesResponse>(
      "/api/access/devices",
      "Failed to load access devices"
    );
  },

  revokeOtherDevices() {
    return postApi<RevokeAccessDevicesResponse>("/api/access/devices/revoke-others");
  },

  revokeDevice(deviceId: string) {
    return deleteApi<RevokeAccessDevicesResponse>(
      `/api/access/devices/${encodeURIComponent(deviceId)}`
    );
  },

  renameDevice(deviceId: string, label: string) {
    return patchApi<UpdateAccessDeviceResponse>(
      `/api/access/devices/${encodeURIComponent(deviceId)}`,
      { label }
    );
  },

  revokeCurrentDevice() {
    return deleteApi<RevokeAccessDevicesResponse>("/api/access/devices/current");
  },

  createDevicePairingLink() {
    return getJson<AccessLinkResponse>(
      "/api/access/link?target=device",
      "Failed to create device pairing link"
    );
  },

  getDevicePairingLinkStatus(pairCode: string) {
    return getJson<AccessLinkStatusResponse>(
      `/api/access/link/${encodeURIComponent(pairCode)}/status`,
      "Failed to load device pairing link status"
    );
  },

  createRecoveryCode() {
    return postApi<CreateAccessRecoveryCodeResponse>("/api/access/recovery-codes");
  }
};
