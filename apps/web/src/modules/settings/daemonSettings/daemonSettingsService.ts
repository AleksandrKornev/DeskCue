import type {
  DaemonSettingsResponse,
  UpdateDaemonSettingsInput
} from "@deskcue/protocol";
import {
  hasBrowserAccessCredential,
  isLoopbackBrowserPage,
  saveConnectionConfig
} from "@api/connection";
import { ensureLocalAccessToken } from "@api/connection/pairing";
import { accessApi } from "@api/endpoint/access/endpoints";

function saveDaemonSettingsConnection(settings: DaemonSettingsResponse) {
  if (!settings.accessToken || !settings.daemonUrl) {
    return;
  }

  saveConnectionConfig({
    accessToken: null,
    deviceId: settings.deviceId ?? null,
    daemonUrl: settings.daemonUrl
  });
}

async function patchDaemonSettings(input: UpdateDaemonSettingsInput) {
  const result = await accessApi.updateDaemonSettings(input);
  if (result.ok) {
    saveDaemonSettingsConnection(result.data);
  }

  return result;
}

export async function updateDaemonSettings(input: UpdateDaemonSettingsInput) {
  if (input.authRequired === true && !isLoopbackBrowserPage()) {
    if (hasBrowserAccessCredential()) {
      return patchDaemonSettings(input);
    }

    const connectionConfig = await ensureLocalAccessToken();
    if (!connectionConfig || !hasBrowserAccessCredential()) {
      return {
        ok: false,
        data: {
          error: "Create a local access token before enabling auth"
        }
      } as const;
    }
  }

  return patchDaemonSettings(input);
}

export async function resetDaemonSettings() {
  const result = await accessApi.resetDaemonSettings();

  if (result.ok) {
    saveDaemonSettingsConnection(result.data);
  }

  return result;
}
