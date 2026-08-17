import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const daemonRoot = join(repoRoot, "apps", "daemon");
const webRoot = join(repoRoot, "apps", "web");
const viteBin = join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const smokeRoot = await mkdtemp(join(tmpdir(), "deskcue-web-smoke-"));
const daemonPort = Number(process.env.DESKCUE_SMOKE_DAEMON_PORT ?? "44100");
const webPort = Number(process.env.DESKCUE_SMOKE_WEB_PORT ?? "45173");
const daemonUrl = `http://127.0.0.1:${daemonPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

let daemonProcess = null;
let webProcess = null;

try {
  daemonProcess = spawnDaemon({
    DESKCUE_ACCESS_TOKEN_FILE: join(smokeRoot, "access-token"),
    DESKCUE_DAEMON_PORT: String(daemonPort),
    DESKCUE_DATABASE_FILE: join(smokeRoot, "deskcue.sqlite"),
    DESKCUE_LISTEN_RETRY_ATTEMPTS: "1",
    DESKCUE_LOG_FILE: join(smokeRoot, "daemon.jsonl"),
    DESKCUE_LOG_TO_STDOUT: "0",
    DESKCUE_STATE_FILE: join(smokeRoot, "state.json")
  });
  webProcess = spawnWeb();

  await waitForHttp(`${daemonUrl}/api/health`, "daemon health");
  await waitForHttp(webUrl, "web dev server");

  const rootHtml = await readText(webUrl);
  assert(rootHtml.includes("root"), "web root HTML does not include the app root");

  const logsHtml = await readText(`${webUrl}/logs`);
  assert(logsHtml.includes("root"), "web /logs HTML does not include the app root");

  const accessLink = await readJson(`${daemonUrl}/api/access/link`);
  const pairingUrl = new URL(accessLink.webUrl);
  assert(
    pairingUrl.pathname === `/pair/${encodeURIComponent(accessLink.pairCode)}`,
    "access link does not use the /pair/:code route"
  );

  console.log(`DeskCue web smoke passed: ${webUrl}`);
  console.log("For real browser verification, open the URL and run the browser smoke checklist.");
} finally {
  await Promise.all([stopProcess(webProcess), stopProcess(daemonProcess)]);
  if (!process.env.DESKCUE_KEEP_SMOKE_DIR) {
    await removeSmokeRoot(smokeRoot);
  }
}

function spawnDaemon(extraEnv) {
  const child = spawn(
    process.execPath,
    ["--conditions=deskcue-source", "--import", "tsx", "src/index.ts"],
    {
    cwd: daemonRoot,
    env: {
      ...process.env,
      ...extraEnv
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
    }
  );

  bindChildOutput(child);

  return child;
}

function spawnWeb() {
  const child = spawn(
    process.execPath,
    [viteBin, "--host", "0.0.0.0", "--port", String(webPort), "--strictPort"],
    {
      cwd: webRoot,
      env: {
        ...process.env
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  bindChildOutput(child);

  return child;
}

function bindChildOutput(child) {
  child.stdout.on("data", (chunk) => {
    if (process.env.DESKCUE_SMOKE_VERBOSE) {
      process.stdout.write(chunk);
    }
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

}

async function waitForHttp(url, label, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function readText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }
  return response.text();
}

async function readJson(url) {
  const response = await fetch(url, {
    headers: {
      "sec-fetch-site": "same-origin"
    }
  });
  if (!response.ok) {
    throw new Error(`${url} failed with ${response.status}`);
  }
  return response.json();
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    delay(3000).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    })
  ]);
}

async function removeSmokeRoot(path) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      await rm(path, {
        force: true,
        recursive: true
      });
      return;
    } catch (error) {
      if (attempt === 8) {
        throw error;
      }
      await delay(250);
    }
  }
}


function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
