import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const daemonRoot = join(repoRoot, "apps", "daemon");
const smokeRoot = await mkdtemp(join(tmpdir(), "deskcue-smoke-"));
const workspacePath = join(smokeRoot, "workspace");
const dataPath = join(smokeRoot, "data");
const databaseFile = join(dataPath, "deskcue.sqlite");
const accessTokenFile = join(dataPath, "access-token");
const logFile = join(dataPath, "daemon.jsonl");
const daemonPort = Number(process.env.DESKCUE_SMOKE_DAEMON_PORT ?? "44100");
const daemonUrl = `http://127.0.0.1:${daemonPort}`;
const agentPath = resolve(repoRoot, "examples/generic-echo-agent.cjs");
const agentCommand = `${quote(process.execPath)} ${quote(agentPath)}`;

let daemonProcess = null;

try {
  await writeFile(join(smokeRoot, ".keep"), "deskcue smoke\n", "utf8");
  await writeFile(join(smokeRoot, "README.txt"), "DeskCue smoke workspace\n", "utf8");
  await writeFile(join(smokeRoot, "workspace-marker.txt"), "created\n", "utf8");
  await rm(workspacePath, {
    force: true,
    recursive: true
  });
  await writeFile(join(smokeRoot, "pre-workspace.txt"), "init\n", "utf8");
  await mkdirp(workspacePath);
  await writeFile(join(workspacePath, "tracked.txt"), "initial\n", "utf8");
  await run("git", ["init"], workspacePath);
  await run("git", ["config", "user.email", "deskcue-smoke@example.invalid"], workspacePath);
  await run("git", ["config", "user.name", "DeskCue Smoke"], workspacePath);
  await run("git", ["add", "tracked.txt"], workspacePath);
  await run("git", ["commit", "-m", "Initial smoke fixture"], workspacePath);
  await writeFile(join(workspacePath, "tracked.txt"), "changed\n", "utf8");

  daemonProcess = startDaemon();
  await waitForHealth();

  const accessLink = await requestJson("/api/access/link");
  assertShape(accessLink, ["daemonUrl", "pairCode", "webUrl"], "access link");

  const pair = await requestJson("/api/access/pair", {
    body: {
      code: accessLink.pairCode
    },
    method: "POST"
  });
  assertShape(pair, ["accessToken", "daemonUrl"], "pair response");

  const authHeaders = {
    authorization: `Bearer ${pair.accessToken}`
  };

  const workspace = await requestJson("/api/workspaces", {
    body: {
      path: workspacePath
    },
    headers: authHeaders,
    method: "POST"
  });
  assert(workspace.id, "workspace id was not returned");

  const session = await requestJson("/api/sessions", {
    body: {
      command: agentCommand,
      workspaceId: workspace.id
    },
    headers: authHeaders,
    method: "POST"
  });
  assert(session.id, "session id was not returned");

  await waitForSessionLog(session.id, authHeaders, "DeskCue generic echo agent ready.");

  await requestJson(`/api/sessions/${session.id}/input`, {
    body: {
      input: "deskcue-smoke-input"
    },
    headers: authHeaders,
    method: "POST"
  });
  await waitForSessionLog(session.id, authHeaders, "DeskCue demo received: deskcue-smoke-input");

  const previewSession = await requestJson(`/api/sessions/${session.id}/preview`, {
    body: {
      port: 4173
    },
    headers: authHeaders,
    method: "POST"
  });
  assert(previewSession.preview?.port === 4173, "preview port was not stored");

  const gitSession = await requestJson(`/api/sessions/${session.id}/refresh-git`, {
    headers: authHeaders,
    method: "POST"
  });
  assert(gitSession.git?.isGitRepo === true, "git repo was not detected");
  assert(
    Array.isArray(gitSession.git.changedFiles) &&
      gitSession.git.changedFiles.some((file) => file.includes("tracked.txt")),
    "changed file was not detected"
  );

  await requestJson(`/api/sessions/${session.id}/input`, {
    body: {
      input: "exit"
    },
    headers: authHeaders,
    method: "POST"
  });

  const finished = await waitForSessionStatus(session.id, authHeaders, "done");
  assert(finished.status === "done", "session did not finish as done");

  const daemonLogs = await requestJson("/api/daemon/logs?limit=50", {
    headers: authHeaders
  });
  assert(Array.isArray(daemonLogs.entries), "daemon logs response did not include entries");
  assert(
    !JSON.stringify(daemonLogs.entries).includes(pair.accessToken),
    "daemon logs leaked the access token"
  );

  console.log(`DeskCue daemon smoke passed on ${daemonUrl}`);
  console.log(`Workspace: ${workspacePath}`);
  console.log(`Database: ${databaseFile}`);
  console.log(`Log file: ${logFile}`);
} finally {
  if (daemonProcess) {
    await stopProcess(daemonProcess);
  }
  if (!process.env.DESKCUE_KEEP_SMOKE_DIR) {
    await removeSmokeRoot(smokeRoot);
  }
}

function startDaemon() {
  const child = spawn(
    process.execPath,
    ["--conditions=deskcue-source", "--import", "tsx", "src/index.ts"],
    {
    cwd: daemonRoot,
    env: {
      ...process.env,
      DESKCUE_ACCESS_TOKEN_FILE: accessTokenFile,
      DESKCUE_DAEMON_PORT: String(daemonPort),
      DESKCUE_DATABASE_FILE: databaseFile,
      DESKCUE_LISTEN_RETRY_ATTEMPTS: "1",
      DESKCUE_LOG_FILE: logFile,
      DESKCUE_LOG_TO_STDOUT: "0",
      DESKCUE_STATE_FILE: join(dataPath, "state.json")
    },
    shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  child.stdout.on("data", (chunk) => {
    if (process.env.DESKCUE_SMOKE_VERBOSE) {
      process.stdout.write(chunk);
    }
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  return child;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${daemonUrl}${path}`, {
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      ...(options.headers ?? {})
    },
    method: options.method ?? "GET",
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed with ${response.status}: ${text}`);
  }

  return payload;
}

async function waitForHealth() {
  await waitUntil(async () => {
    try {
      const response = await fetch(`${daemonUrl}/api/health`);
      return response.ok;
    } catch {
      return false;
    }
  }, "daemon health");
}

async function waitForSessionLog(sessionId, headers, expectedText) {
  await waitUntil(async () => {
    const session = await requestJson(`/api/sessions/${sessionId}`, {
      headers
    });
    return session.logs?.some((log) => String(log.text).includes(expectedText));
  }, `session log: ${expectedText}`);
}

async function waitForSessionStatus(sessionId, headers, expectedStatus) {
  let lastSession = null;
  await waitUntil(async () => {
    lastSession = await requestJson(`/api/sessions/${sessionId}`, {
      headers
    });
    return lastSession.status === expectedStatus;
  }, `session status ${expectedStatus}`);

  return lastSession;
}

async function waitUntil(callback, label, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await callback()) {
      return;
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function run(file, args, cwd) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      cwd,
      shell: false,
      stdio: "pipe"
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${file} ${args.join(" ")} failed with ${code}: ${stderr}`));
      }
    });
  });
}

async function mkdirp(path) {
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(path, {
      recursive: true
    })
  );
}

async function stopProcess(child) {
  if (child.exitCode !== null) {
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

function assertShape(value, keys, label) {
  for (const key of keys) {
    assert(value?.[key], `${label} missing ${key}`);
  }
}

function quote(value) {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
