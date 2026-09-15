import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { isPackagedCli, resolveCliDataRoot } from "./paths.ts";

const WORKSPACE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("source CLI data root does not depend on the caller working directory", () => {
  const previousCwd = process.cwd();
  const previousDataDir = process.env.DESKCUE_DATA_DIR;
  const previousMode = process.env.DESKCUE_DISTRIBUTION_MODE;

  try {
    delete process.env.DESKCUE_DATA_DIR;
    delete process.env.DESKCUE_DISTRIBUTION_MODE;
    process.chdir(tmpdir());

    assert.equal(resolveCliDataRoot(), resolve(WORKSPACE_ROOT, ".deskcue-data"));
  } finally {
    process.chdir(previousCwd);
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    if (previousMode === undefined) delete process.env.DESKCUE_DISTRIBUTION_MODE;
    else process.env.DESKCUE_DISTRIBUTION_MODE = previousMode;
  }
});

test("packaged CLI uses the stable per-user data root", () => {
  const previousDataDir = process.env.DESKCUE_DATA_DIR;
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const previousMode = process.env.DESKCUE_DISTRIBUTION_MODE;
  const previousXdgDataHome = process.env.XDG_DATA_HOME;

  try {
    const dataHome = join(tmpdir(), "DeskCue Test User Data");

    process.env.DESKCUE_DISTRIBUTION_MODE = "installed";

    process.env.LOCALAPPDATA = dataHome;
    process.env.XDG_DATA_HOME = dataHome;
    delete process.env.DESKCUE_DATA_DIR;

    assert.equal(isPackagedCli(), true);
    assert.equal(
      resolveCliDataRoot(),
      join(dataHome, process.platform === "linux" ? "deskcue" : "DeskCue", "data")
    );
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    if (previousMode === undefined) delete process.env.DESKCUE_DISTRIBUTION_MODE;
    else process.env.DESKCUE_DISTRIBUTION_MODE = previousMode;
    if (previousXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousXdgDataHome;
  }
});

test("explicit data directory remains authoritative in packaged mode", () => {
  const previousDataDir = process.env.DESKCUE_DATA_DIR;
  const previousMode = process.env.DESKCUE_DISTRIBUTION_MODE;

  try {
    const explicitDataRoot = join(tmpdir(), "DeskCue explicit data");

    process.env.DESKCUE_DISTRIBUTION_MODE = "installed";

    process.env.DESKCUE_DATA_DIR = explicitDataRoot;

    assert.equal(resolveCliDataRoot(), explicitDataRoot);
  } finally {
    if (previousDataDir === undefined) delete process.env.DESKCUE_DATA_DIR;
    else process.env.DESKCUE_DATA_DIR = previousDataDir;
    if (previousMode === undefined) delete process.env.DESKCUE_DISTRIBUTION_MODE;
    else process.env.DESKCUE_DISTRIBUTION_MODE = previousMode;
  }
});
