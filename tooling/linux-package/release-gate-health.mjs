import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HEALTH_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

async function runStatus(cliPath) {
  const { stdout } = await execFileAsync(cliPath, ["status", "--json"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });

  return JSON.parse(stdout).data?.status;
}

export async function waitForVersion(cliPath, expectedVersion) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let confirmations = 0;

  while (Date.now() < deadline) {
    try {
      const status = await runStatus(cliPath);

      if (status?.host?.version === expectedVersion &&
          status?.daemon?.version === expectedVersion &&
          status?.host?.state === "running" &&
          status?.daemon?.state === "running") {
        confirmations += 1;
        if (confirmations >= 3) return status;
      } else {
        confirmations = 0;
      }
    } catch {
      confirmations = 0;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, POLL_INTERVAL_MS));
  }

  throw new Error(`DeskCue ${expectedVersion} did not become healthy before the release-gate deadline.`);
}

export async function waitForFileContents(path, expectedContents, description) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      if (await readFile(path, "utf8") === expectedContents) return;
    } catch {
      // The expected release-gate process has not written its marker yet.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, POLL_INTERVAL_MS));
  }

  throw new Error(`DeskCue did not record ${description}.`);
}

export async function waitForRollbackState(statePath, currentVersion, targetVersion) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await readFile(statePath, "utf8"));

      if (state.currentVersion === currentVersion && state.targetVersion === targetVersion &&
          ["failed", "staged"].includes(state.phase)) {
        return state;
      }
    } catch {
      // The Host may be replacing or reconciling the state file.
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, POLL_INTERVAL_MS));
  }

  throw new Error(`DeskCue did not record rollback from ${targetVersion} to ${currentVersion}.`);
}
