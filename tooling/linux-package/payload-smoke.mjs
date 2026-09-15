import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { LINUX_NODE_VERSION } from "./payload-constants.mjs";

export function runLinuxPayloadSmoke(payloadRoot, architecture) {
  const appRoot = join(payloadRoot, "app");
  const nodeExecutablePath = join(payloadRoot, "runtime", "node");
  const probeScript = [
    "const { createRequire } = require('node:module');",
    "const { join } = require('node:path');",
    "const requireFromPayload = createRequire(join(process.cwd(), 'payload-probe.cjs'));",
    "requireFromPayload('better-sqlite3');",
    "requireFromPayload('@lydell/node-pty');",
    "process.stdout.write(JSON.stringify({ arch: process.arch, version: process.version }));"
  ].join("");
  const nativeProbe = spawnSync(nodeExecutablePath, ["-e", probeScript], {
    cwd: appRoot,
    encoding: "utf8"
  });

  if (nativeProbe.status !== 0) {
    throw new Error(`Bundled Linux native dependency probe failed:\n${nativeProbe.stderr || nativeProbe.stdout}`);
  }

  const runtimeIdentity = JSON.parse(nativeProbe.stdout);

  if (runtimeIdentity.arch !== architecture || runtimeIdentity.version !== `v${LINUX_NODE_VERSION}`) {
    throw new Error(`Bundled Linux Node identity mismatch: ${nativeProbe.stdout}`);
  }

  const cliProbe = spawnSync(
    nodeExecutablePath,
    [join(appRoot, "apps", "cli", "dist", "index.js"), "help"],
    { cwd: appRoot, encoding: "utf8" }
  );

  if (cliProbe.status !== 0) {
    throw new Error(`Packaged Linux CLI probe failed:\n${cliProbe.stderr || cliProbe.stdout}`);
  }
}
