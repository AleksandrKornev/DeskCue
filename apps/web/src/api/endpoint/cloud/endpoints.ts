import type {
  CloudConnectionStatusResponse,
  CloudEnrollmentAttemptResponse,
  ConnectCloudInput,
  StartCloudEnrollmentAttemptInput,
  UpdateCloudPermissionsInput,
  UpdateCloudSessionDisclosureInput
} from "@deskcue/protocol";
import { deleteApi, getJson, patchApi, postApi } from "@api/transport/requests";

export const cloudApi = {
  getConnection() {
    return getJson<CloudConnectionStatusResponse>(
      "/api/cloud/connection",
      "Failed to load DeskCue Cloud connection"
    );
  },

  connect(input: ConnectCloudInput) {
    return postApi<CloudConnectionStatusResponse>(
      "/api/cloud/connection",
      input,
      { timeoutMs: 20_000 }
    );
  },

  disconnect() {
    return deleteApi<CloudConnectionStatusResponse>("/api/cloud/connection");
  },

  updateSessionDisclosure(input: UpdateCloudSessionDisclosureInput) {
    return patchApi<CloudConnectionStatusResponse>(
      "/api/cloud/connection/session-disclosure",
      input
    );
  },

  updatePermissions(input: UpdateCloudPermissionsInput) {
    return patchApi<CloudConnectionStatusResponse>(
      "/api/cloud/connection/permissions",
      input
    );
  },

  getEnrollmentAttempt() {
    return getJson<CloudEnrollmentAttemptResponse>(
      "/api/cloud/enrollment-attempt",
      "Failed to load Cloud enrollment status"
    );
  },

  startEnrollmentAttempt(input: StartCloudEnrollmentAttemptInput) {
    return postApi<CloudEnrollmentAttemptResponse>(
      "/api/cloud/enrollment-attempts",
      input,
      { timeoutMs: 20_000 }
    );
  },

  cancelEnrollmentAttempt() {
    return deleteApi<CloudEnrollmentAttemptResponse>("/api/cloud/enrollment-attempt");
  }
};
