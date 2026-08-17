import axios from "axios";

import { buildApiUrl } from "@api/connection/config";
import {
  getDeskCueRuntime,
  readCloudMutationCsrfToken
} from "@runtime";

export const api = axios.create({
  withCredentials: true,
  timeout: 15_000,
  headers: {
    "Cache-Control": "no-cache, no-store",
    "Pragma": "no-cache"
  }
});

api.interceptors.request.use((config) => {
  const runtime = getDeskCueRuntime();
  const accessToken = runtime.getAuthorizationToken();

  if (config.url) {
    config.url = buildApiUrl(config.url);
  }

  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  if (runtime.mode === "cloud-machine" && config.url) {
    const csrfToken = readCloudMutationCsrfToken(
      config.method,
      config.url,
      window.location
    );
    if (csrfToken) {
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }

  return config;
});
