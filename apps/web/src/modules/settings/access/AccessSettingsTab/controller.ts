import { forgetAccessToken } from "@api/connection";
import { accessApi } from "@api/endpoint/access/endpoints";
import { requestConfirmation } from "@components/ModalDialog";

export const accessSettingsController = {
  confirm: requestConfirmation,
  forgetAccessToken,
  getDevices: () => accessApi.getDevices(),
  renameDevice: (deviceId: string, label: string) => accessApi.renameDevice(deviceId, label),
  revokeCurrentDevice: () => accessApi.revokeCurrentDevice(),
  revokeDevice: (deviceId: string) => accessApi.revokeDevice(deviceId),
  revokeOtherDevices: () => accessApi.revokeOtherDevices()
};

export type AccessSettingsController = typeof accessSettingsController;
