import { toast } from "sonner";

import { fetchSecurityStatus } from "@api/connection/securityStatusRequests";
import { accessApi } from "@api/endpoint/access/endpoints";
import { requestConfirmation } from "@components/ModalDialog";

import { resetDaemonSettings, updateDaemonSettings } from "./daemonSettingsService";

export const daemonSettingsController = {
  fetchSecurityStatus,
  getDaemonSettings: () => accessApi.getDaemonSettings(),
  notifyReset: () => toast.success("Reset to env"),
  notifySaved: () => toast.success("Saved"),
  requestResetConfirmation: () => requestConfirmation({
    confirmLabel: "Reset to env",
    description: "Web overrides will be cleared and DeskCue will use environment values.",
    title: "Reset web overrides?"
  }),
  resetDaemonSettings,
  updateDaemonSettings
};

export type DaemonSettingsController = typeof daemonSettingsController;
