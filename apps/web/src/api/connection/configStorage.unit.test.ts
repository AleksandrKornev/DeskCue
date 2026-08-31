import { beforeEach, describe, expect, it } from "vitest";

import {
  getConnectionConfig,
  invalidateConnectionConfigCache,
  saveConnectionConfig
} from "./configStorage";
import { CONNECTION_CONFIG_CHANGED_EVENT } from "./events";

describe("connection config storage", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    invalidateConnectionConfigCache();
  });

  it("removes legacy query credentials after reading them without changing the rest of the URL", () => {
    window.history.replaceState(
      { navigation: "preserved" },
      "",
      "/sessions/session-1?keep=value&deskcueDaemon=http%3A%2F%2Fdeskcue.test%3A4100&deskcueToken=legacy-credential&token=shadowed-credential#changes"
    );

    const config = getConnectionConfig();
    const scrubbedUrl = new URL(window.location.href);

    expect(config).toEqual({
      accessToken: "legacy-credential",
      daemonUrl: "http://deskcue.test:4100",
      deviceId: null
    });

    expect(scrubbedUrl.pathname).toBe("/sessions/session-1");
    expect(scrubbedUrl.searchParams.get("keep")).toBe("value");
    expect(scrubbedUrl.searchParams.get("deskcueDaemon")).toBe(
      "http://deskcue.test:4100"
    );

    expect(scrubbedUrl.searchParams.has("deskcueToken")).toBe(false);
    expect(scrubbedUrl.searchParams.has("token")).toBe(false);
    expect(scrubbedUrl.hash).toBe("#changes");
    expect(window.history.state).toEqual({ navigation: "preserved" });
    expect(localStorage.getItem("deskcue.daemonUrl")).toBe(
      "http://deskcue.test:4100"
    );
  });

  it("reads and removes the short legacy token alias", () => {
    window.history.replaceState(
      null,
      "",
      "/workspace?token=legacy-alias&keep=1#files"
    );

    expect(getConnectionConfig().accessToken).toBe("legacy-alias");
    expect(window.location.pathname).toBe("/workspace");
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#files");
  });

  it("uses valid connection aliases after empty higher-priority values", () => {
    window.history.replaceState(
      null,
      "",
      "/?deskcueDaemon=&daemon=http%3A%2F%2Fdeskcue.test%3A4100&deskcueToken=&token=legacy-token"
    );

    expect(getConnectionConfig()).toEqual({
      accessToken: "legacy-token",
      daemonUrl: "http://deskcue.test:4100",
      deviceId: null
    });

    expect(localStorage.getItem("deskcue.daemonUrl")).toBe("http://deskcue.test:4100");
  });

  it("does not persist an arbitrary target from conflicting daemon aliases", () => {
    localStorage.setItem("deskcue.daemonUrl", "http://stored.test:4100");
    window.history.replaceState(
      null,
      "",
      "/?deskcueDaemon=http%3A%2F%2Ffirst.test%3A4100&daemon=http%3A%2F%2Fsecond.test%3A4100" +
        "&deskcueToken=first-token&token=second-token"
    );

    expect(getConnectionConfig()).toEqual({
      accessToken: "first-token",
      daemonUrl: "http://stored.test:4100",
      deviceId: null
    });

    expect(localStorage.getItem("deskcue.daemonUrl")).toBe("http://stored.test:4100");
    expect(window.location.search).toContain("deskcueDaemon=");
    expect(window.location.search).not.toContain("deskcueToken=");
    expect(window.location.search).not.toContain("token=");
  });

  it("does not replace a stored daemon with an unsupported query target", () => {
    localStorage.setItem("deskcue.daemonUrl", "http://stored.test:4100");
    window.history.replaceState(
      null,
      "",
      "/?daemon=ftp%3A%2F%2Finvalid.test%3A4100"
    );

    expect(getConnectionConfig().daemonUrl).toBe("http://stored.test:4100");
    expect(localStorage.getItem("deskcue.daemonUrl")).toBe("http://stored.test:4100");
  });

  it("emits lifecycle invalidation only when the effective connection changes", () => {
    const initial = {
      accessToken: null,
      daemonUrl: "http://deskcue.test:4100",
      deviceId: "device-1"
    };

    saveConnectionConfig(initial);
    let eventCount = 0;

    const handleChanged = () => {
      eventCount += 1;
    };

    window.addEventListener(CONNECTION_CONFIG_CHANGED_EVENT, handleChanged);

    saveConnectionConfig({ ...initial });
    expect(eventCount).toBe(0);

    saveConnectionConfig({ ...initial, deviceId: "device-2" });
    expect(eventCount).toBe(1);

    window.removeEventListener(CONNECTION_CONFIG_CHANGED_EVENT, handleChanged);
  });
});
