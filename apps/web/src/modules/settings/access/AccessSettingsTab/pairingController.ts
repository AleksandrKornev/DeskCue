import { toast } from "sonner";

import { buildCurrentDaemonAccessSettingsUrl } from "@api/connection";
import { accessApi } from "@api/endpoint/access/endpoints";
import { requestConfirmation } from "@components/ModalDialog";

import { createDevicePairingLink } from "./accessPairingService";

export const accessPairingController = {
  buildCurrentDaemonAccessSettingsUrl,
  clearInterval: (id: number) => window.clearInterval(id),
  createDevicePairingLink,
  createRecoveryCode: () => accessApi.createRecoveryCode(),
  getDevicePairingLinkStatus: (pairCode: string) =>
    accessApi.getDevicePairingLinkStatus(pairCode),
  notifyInfo: (message: string) => toast.info(message),
  notifySuccess: (message: string) => toast.success(message),
  requestConfirmation,
  setInterval: (callback: () => void, delayMs: number) => window.setInterval(callback, delayMs),
  writeClipboard: (value: string) => navigator.clipboard.writeText(value)
};

export type AccessPairingController = typeof accessPairingController;
