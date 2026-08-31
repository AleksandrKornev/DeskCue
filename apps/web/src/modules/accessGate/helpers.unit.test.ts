import { describe, expect, it } from "vitest";

import {
  readConnectionPreparationKind,
  readConnectionPreparationRetryPath,
  readReturnPath
} from "./helpers";

function buildReturnSearch(returnPath: string) {
  return `?from=${encodeURIComponent(returnPath)}`;
}

describe("readReturnPath", () => {
  it("keeps a same-origin path with query and hash", () => {
    expect(readReturnPath(buildReturnSearch("/sessions/session-1?tab=activity#entry-2")))
      .toBe("/sessions/session-1?tab=activity#entry-2");
  });

  it.each([
    "//example.com",
    "/\\example.com",
    "/%5Cexample.com",
    "dashboard"
  ])("rejects unsafe or non-rooted return path %s", (returnPath) => {
    expect(readReturnPath(buildReturnSearch(returnPath))).toBeNull();
  });
});

describe("readConnectionPreparationKind", () => {
  it.each([
    ["/pair/pair-code", "pair"],
    ["/?deskcuePair=pair-code", "pair"],
    ["/?pair=&pair=pair-code", "pair"],
    ["/recover/recovery-code", "recover"],
    ["/connect?recovery=recovery-code", "recover"],
    ["/connect?deskcueRecovery=&deskcueRecovery=recovery-code", "recover"]
  ] as const)("recognizes %s as %s preparation", (path, kind) => {
    expect(readConnectionPreparationKind(path)).toBe(kind);
  });

  it("does not classify ordinary return paths", () => {
    expect(readConnectionPreparationKind("/sessions/session-1?tab=activity")).toBeNull();
  });

  it.each([
    "/pair/%20",
    "/pair/%09",
    "/pair/%C2%A0",
    "/recover/%20",
    "/recover/%09",
    "/recover/%C2%A0"
  ])("does not classify a whitespace-only path code: %s", (path) => {
    expect(readConnectionPreparationKind(path)).toBeNull();
  });
});

describe("readConnectionPreparationRetryPath", () => {
  it("restores an offline pairing or recovery URL for an actual retry", () => {
    expect(readConnectionPreparationRetryPath(
      buildReturnSearch("/pair/pair-code") + "&reason=offline"
    )).toBe("/pair/pair-code");
    expect(readConnectionPreparationRetryPath(
      buildReturnSearch("/recover/recovery-code") + "&reason=offline"
    )).toBe("/recover/recovery-code");
    expect(readConnectionPreparationRetryPath(
      buildReturnSearch("/connect?recovery=recovery-code") + "&reason=offline"
    )).toBe("/connect?recovery=recovery-code");
    expect(readConnectionPreparationRetryPath(
      buildReturnSearch("/pair/pair-code") + "&reason=preparation"
    )).toBe("/pair/pair-code");
    expect(readConnectionPreparationRetryPath(
      buildReturnSearch("/?pair=&pair=pair-code") + "&reason=preparation"
    )).toBe("/?pair=&pair=pair-code");
  });

  it("does not reopen an ordinary path or a rejected one-time link", () => {
    expect(readConnectionPreparationRetryPath(
      buildReturnSearch("/sessions/session-1") + "&reason=offline"
    )).toBeNull();
    expect(readConnectionPreparationRetryPath(
      buildReturnSearch("/pair/pair-code") + "&reason=unauthorized"
    )).toBeNull();
  });

  it.each([
    "/pair/%20",
    "/pair/%09",
    "/pair/%C2%A0",
    "/recover/%20",
    "/recover/%09",
    "/recover/%C2%A0"
  ])("does not reopen a whitespace-only one-time path: %s", (returnPath) => {
    expect(readConnectionPreparationRetryPath(
      buildReturnSearch(returnPath) + "&reason=offline"
    )).toBeNull();
  });
});
