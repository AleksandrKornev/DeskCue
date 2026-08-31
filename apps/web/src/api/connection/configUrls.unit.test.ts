import { describe, expect, it } from "vitest";

import { normalizeDaemonUrl } from "./configUrls";

describe("daemon URL normalization", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/plain,deskcue",
    "file:///tmp/deskcue",
    "ftp://deskcue.test:4100",
    "http://user:password@deskcue.test:4100",
    "https://user@deskcue.test"
  ])("rejects a non-HTTP or credential-bearing daemon URL: %s", (value) => {
    expect(normalizeDaemonUrl(value)).toBeNull();
  });

  it("keeps an HTTP origin while removing path, query, hash, and a trailing slash", () => {
    expect(normalizeDaemonUrl("https://deskcue.test:4100/path?query=1#hash"))
      .toBe("https://deskcue.test:4100");
  });
});
