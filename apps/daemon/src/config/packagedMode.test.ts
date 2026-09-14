import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  getPackagedDataRootPath,
  isPackagedMode
} from "./packagedMode.ts";

test("recognizes only explicit true packaged-mode values", () => {
  for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
    assert.equal(isPackagedMode({ DESKCUE_PACKAGED: value }), true);
  }

  for (const value of [undefined, "", "0", "false", "no", "off", "invalid"]) {
    assert.equal(isPackagedMode({ DESKCUE_PACKAGED: value }), false);
  }
});

test("uses the Windows local application data directory for packaged state", () => {
  assert.equal(
    getPackagedDataRootPath({
      environment: {
        LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local"
      },
      homeDirectory: "C:\\Users\\Ignored",
      platform: "win32"
    }),
    path.win32.join("C:\\Users\\Example\\AppData\\Local", "DeskCue", "data")
  );
});

test("falls back to the standard Windows local application data path", () => {
  assert.equal(
    getPackagedDataRootPath({
      environment: {},
      homeDirectory: "C:\\Users\\Example",
      platform: "win32"
    }),
    path.win32.join("C:\\Users\\Example", "AppData", "Local", "DeskCue", "data")
  );
});
