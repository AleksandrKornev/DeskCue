import { describe, expect, it } from "vitest";

import { readSameOriginNotificationUrl } from "./notificationUrl";

describe("readSameOriginNotificationUrl", () => {
  it("keeps same-origin notification targets", () => {
    expect(readSameOriginNotificationUrl("/sessions/1", "https://deskcue.test"))
      .toBe("https://deskcue.test/sessions/1");
  });

  it("rejects cross-origin and malformed notification targets", () => {
    expect(readSameOriginNotificationUrl("https://tracker.test/pixel", "https://deskcue.test"))
      .toBe("https://deskcue.test/");
    expect(readSameOriginNotificationUrl("http://[", "https://deskcue.test"))
      .toBe("https://deskcue.test/");
  });
});
