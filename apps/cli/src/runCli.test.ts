import assert from "node:assert/strict";
import test from "node:test";

import { HostControlConnectionClosedError, HostControlTokenReadError } from "@deskcue/host-control";
import type { HostControlMethod, HostStatus } from "@deskcue/host-control";

import { CLI_EXIT_CODES } from "./exitCodes.ts";
import { HostControlRejectedError } from "./host/hostClient.ts";
import type { HostRequest } from "./host/hostClient.ts";
import { runCli } from "./runCli.ts";

function createStatus(daemonState: HostStatus["daemon"]["state"]): HostStatus {
  return {
    autostart: {
      enabled: false,
      supported: true
    },
    busyReason: null,
    capabilities: {
      "autostart.disable": { allowed: true, reason: null },
      "autostart.enable": { allowed: true, reason: null },
      "autostart.get": { allowed: true, reason: null },
      "daemon.restart": { allowed: true, reason: null },
      "daemon.start": { allowed: true, reason: null },
      "daemon.stop": { allowed: true, reason: null },
      "host.shutdown": { allowed: true, reason: null },
      status: { allowed: true, reason: null },
      "update.apply": { allowed: true, reason: null },
      "update.check": { allowed: true, reason: null }
    },
    daemon: {
      baseUrl: daemonState === "running" ? "http://127.0.0.1:4100" : null,
      generation: daemonState === "running" ? "generation-1" : null,
      lastError: null,
      pid: daemonState === "running" ? 200 : null,
      port: daemonState === "running" ? 4100 : null,
      restartAttempt: 0,
      state: daemonState,
      version: daemonState === "running" ? "0.1.1" : null
    },
    host: {
      pid: 100,
      startedAt: "2026-09-13T00:00:00.000Z",
      state: "running",
      version: "0.1.1"
    },
    update: {
      availableVersion: null,
      lastError: null,
      state: "idle"
    }
  };
}

function captureIo() {
  let stderr = "";
  let stdout = "";

  return {
    io: {
      stderr(text: string) {
        stderr += text;
      },
      stdout(text: string) {
        stdout += text;
      }
    },
    read() {
      return { stderr, stdout };
    }
  };
}

function unavailableStatusFetch() {
  return Promise.resolve(new Response("{}", { status: 503 }));
}

test("status is machine-readable and returns inactive when the daemon is stopped", async () => {
  const output = captureIo();
  const exitCode = await runCli(["status", "--json"], {
    io: output.io,
    requestHost: async () => createStatus("stopped")
  });

  assert.equal(exitCode, CLI_EXIT_CODES.inactive);
  const result = JSON.parse(output.read().stdout);

  assert.equal(result.data.status.daemon.state, "stopped");
  assert.equal(result.ok, false);
  assert.equal(output.read().stderr, "");
});

test("status remains inactive during lifecycle transitions", async () => {
  const output = captureIo();
  const exitCode = await runCli(["status"], {
    io: output.io,
    requestHost: async () => createStatus("starting")
  });

  assert.equal(exitCode, CLI_EXIT_CODES.inactive);
});

test("human status includes daemon and update failure details", async () => {
  const output = captureIo();
  const status = createStatus("degraded");

  status.daemon.version = "0.1.1";
  status.daemon.lastError = "Crash loop exhausted.\u001b]0;spoofed\u0007";
  status.update.state = "failed";
  status.update.lastError = "Manifest signature is invalid.";
  const exitCode = await runCli(["status"], {
    io: output.io,
    requestHost: async () => status
  });

  assert.equal(exitCode, CLI_EXIT_CODES.failure);
  assert.match(output.read().stdout, /DeskCue 0\.1\.1\s+NEEDS ATTENTION/u);
  assert.match(output.read().stdout, /Host\s+running\s+PID 100/u);
  assert.match(output.read().stdout, /Daemon\s+degraded\s+\(version 0\.1\.1\)/u);
  assert.match(output.read().stdout, /Daemon error: Crash loop exhausted\./u);
  assert.match(output.read().stdout, /Update error: Manifest signature is invalid\./u);
  assert.match(output.read().stdout, /Next\n  Run deskcue logs --lines 100\./u);
  assert.match(output.read().stdout, /Check the release channel/u);
  assert.doesNotMatch(output.read().stdout, /\u001b/u);
});

test("start launches a missing Host once and waits for a running daemon", async () => {
  const calls: HostControlMethod[] = [];
  const output = captureIo();
  let statusAttempts = 0;
  let launches = 0;
  const exitCode = await runCli(["start"], {
    io: output.io,
    launchHost: async () => {
      launches += 1;
    },
    requestHost: async (method) => {
      calls.push(method);
      if (method === "status") {
        statusAttempts += 1;
        if (statusAttempts === 1) {
          const error = new Error("missing") as NodeJS.ErrnoException;

          error.code = "ENOENT";

          throw error;
        }

        return createStatus("stopped");
      }

      assert.equal(method, "daemon.start");
      return createStatus("running");
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.equal(launches, 1);
  assert.deepEqual(calls, ["status", "status", "daemon.start"]);
  assert.match(output.read().stdout, /Host and daemon are running/u);
});

test("human status reports the active update phase before the target version", async () => {
  const output = captureIo();
  const status = createStatus("running");

  status.update.availableVersion = "0.2.0";
  status.update.state = "applying";
  status.busyReason = "DeskCue update is applying.";
  const exitCode = await runCli(["status"], {
    fetch: unavailableStatusFetch,
    io: output.io,
    requestHost: async () => status
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.match(output.read().stdout, /Busy: DeskCue update is applying\./u);
  assert.match(output.read().stdout, /Update\s+applying 0\.2\.0/u);
  assert.doesNotMatch(output.read().stdout, /Update\s+available/u);
});

test("human status reports available updates state first", async () => {
  const output = captureIo();
  const status = createStatus("running");

  status.update.availableVersion = "0.2.0";
  status.update.state = "available";
  const exitCode = await runCli(["status"], {
    fetch: unavailableStatusFetch,
    io: output.io,
    requestHost: async () => status
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.match(output.read().stdout, /Update\s+available 0\.2\.0/u);
});

test("human status shows real chat counts, last activity, agents and local runtimes", async () => {
  const output = captureIo();
  const snapshot = {
    activeChatCount: 2,
    activeChatCountExact: true,
    chatCount: 264,
    chatCountExact: true,
    generatedAt: "2026-09-14T18:50:46.000Z",
    lastChat: {
      id: "codex:session-1",
      model: "gpt-5",
      sourceId: "codex",
      sourceLabel: "Codex",
      title: "Continue DeskCue",
      updatedAt: "2026-09-14T18:50:45.000Z",
      workspaceName: "DeskCueWorkspace"
    },
    runtimes: [
      {
        activeChatCount: 2,
        activeChatCountExact: true,
        chatCount: 228,
        chatCountExact: true,
        id: "codex",
        installed: true,
        label: "Codex",
        lastActiveModel: null,
        loadedModelCount: 0,
        modelCount: 0,
        running: false,
        statusText: "installed, local chat history can be restored"
      },
      {
        activeChatCount: 0,
        activeChatCountExact: true,
        chatCount: 36,
        chatCountExact: true,
        id: "claude-code",
        installed: true,
        label: "Claude Code",
        lastActiveModel: null,
        loadedModelCount: 0,
        modelCount: 0,
        running: false,
        statusText: "installed, no live sessions detected"
      }
    ]
  };

  const exitCode = await runCli(["status"], {
    fetch: async () => Response.json(snapshot),
    io: output.io,
    requestHost: async () => createStatus("running")
  });
  const text = output.read().stdout;

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.match(text, /264 total\s+\|\s+2 active/u);
  assert.match(text, /Last activity\n  Continue DeskCue/u);
  assert.match(text, /Codex\s+\|\s+gpt-5\s+\|\s+DeskCueWorkspace/u);
  assert.match(text, /AVAILABLE\s+Codex\s+228 chats, 2 active/u);
});

test("human status rejects internally inconsistent daemon activity counts", async () => {
  const output = captureIo();
  const exitCode = await runCli(["status"], {
    fetch: async () => Response.json({
      activeChatCount: 999,
      activeChatCountExact: true,
      chatCount: 0,
      chatCountExact: true,
      generatedAt: "2026-09-14T18:50:46.000Z",
      lastChat: null,
      runtimes: []
    }),
    io: output.io,
    requestHost: async () => createStatus("running")
  });
  const text = output.read().stdout;

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.match(text, /temporarily unavailable/u);
  assert.doesNotMatch(text, /999 active/u);
});

test("stop and restart messages state their actual lifecycle scope", async () => {
  const stoppedOutput = captureIo();
  const restartedOutput = captureIo();

  assert.equal(await runCli(["stop"], {
    io: stoppedOutput.io,
    requestHost: async (method) => method === "status" ? createStatus("running") : createStatus("stopped")
  }), CLI_EXIT_CODES.success);
  assert.match(stoppedOutput.read().stdout, /daemon is stopped\. The Host remains running\./u);

  assert.equal(await runCli(["restart"], {
    io: restartedOutput.io,
    requestHost: async () => createStatus("running")
  }), CLI_EXIT_CODES.success);
  assert.match(restartedOutput.read().stdout, /daemon restarted.*Host remained running/u);
});

test("start waits for the Host initial daemon start without dispatching a duplicate start", async () => {
  const calls: HostControlMethod[] = [];
  const output = captureIo();
  let statusAttempts = 0;
  const exitCode = await runCli(["start", "--json"], {
    io: output.io,
    requestHost: async (method) => {
      calls.push(method);
      assert.equal(method, "status");
      statusAttempts += 1;

      return createStatus(statusAttempts === 1 ? "starting" : "running");
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.deepEqual(calls, ["status", "status"]);
  assert.equal(JSON.parse(output.read().stdout).ok, true);
});

test("open --print does not launch a browser", async () => {
  const output = captureIo();
  let opens = 0;
  const exitCode = await runCli(["open", "--print"], {
    io: output.io,
    openUrl: async () => {
      opens += 1;
    },
    requestHost: async () => createStatus("running")
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.equal(opens, 0);
  assert.match(output.read().stdout, /127\.0\.0\.1:4100/u);
});

test("focused JSON commands omit the unrelated Host capability snapshot", async () => {
  const openOutput = captureIo();
  const autostartOutput = captureIo();
  const updateOutput = captureIo();

  await runCli(["open", "--print", "--json"], {
    io: openOutput.io,
    requestHost: async () => createStatus("running")
  });
  await runCli(["autostart", "status", "--json"], {
    io: autostartOutput.io,
    requestHost: async () => createStatus("running")
  });
  await runCli(["update", "--check", "--json"], {
    io: updateOutput.io,
    requestHost: async () => createStatus("running")
  });

  assert.deepEqual(Object.keys(JSON.parse(openOutput.read().stdout).data), ["url"]);
  assert.deepEqual(Object.keys(JSON.parse(autostartOutput.read().stdout).data), ["autostart"]);
  assert.deepEqual(Object.keys(JSON.parse(updateOutput.read().stdout).data), ["update"]);
});

test("Host safety refusal maps to a stable refused exit code", async () => {
  const output = captureIo();
  const exitCode = await runCli(["update"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "status") return createStatus("running");

      throw new HostControlRejectedError("busy", "An agent turn is running.", false);
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.refused);
  assert.match(output.read().stderr, /agent turn is running/iu);
});

test("Host lifecycle conflicts map to the refused exit code", async () => {
  const output = captureIo();
  const exitCode = await runCli(["restart"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "status") return createStatus("running");

      throw new HostControlRejectedError("update_in_progress", "An update is being applied.", false);
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.refused);
  assert.match(output.read().stderr, /update is being applied/iu);
});

test("typed Host refusals are not reclassified by timeout words in their message", async () => {
  const output = captureIo();
  const exitCode = await runCli(["restart", "--json"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "status") return createStatus("running");

      throw new HostControlRejectedError(
        "not_allowed",
        "Another operation timed out, so restart is not allowed.",
        false
      );
    }
  });
  const result = JSON.parse(output.read().stdout);

  assert.equal(exitCode, CLI_EXIT_CODES.refused);
  assert.equal(result.error.code, "not_allowed");
});

test("Host safety refusal preserves typed blockers in human and JSON output", async () => {
  const blockerDetails = {
    blockers: [{ code: "active_agent_turns", count: 2, message: "Two turns are active." }]
  };

  const humanOutput = captureIo();
  const jsonOutput = captureIo();

  const requestHost = async (method: HostControlMethod) => {
    if (method === "status") return createStatus("running");

    throw new HostControlRejectedError(
      "update_blocked",
      "DeskCue cannot update while local work is active.",
      false,
      blockerDetails
    );
  };

  assert.equal(
    await runCli(["update"], { io: humanOutput.io, requestHost }),
    CLI_EXIT_CODES.refused
  );

  assert.match(humanOutput.read().stderr, /Two turns are active\. \(active_agent_turns, count: 2\)/u);

  assert.equal(
    await runCli(["update", "--json"], { io: jsonOutput.io, requestHost }),
    CLI_EXIT_CODES.refused
  );

  assert.deepEqual(JSON.parse(jsonOutput.read().stdout).error.details, blockerDetails);
  assert.equal(JSON.parse(jsonOutput.read().stdout).error.retryable, false);
});

test("retryable Host failures remain machine-readable", async () => {
  const output = captureIo();
  const exitCode = await runCli(["restart", "--json"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "status") return createStatus("running");

      throw new HostControlRejectedError("update_readiness_failed", "Try again.", true);
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.failure);
  assert.equal(JSON.parse(output.read().stdout).error.retryable, true);
});

test("a generic timeout does not claim that repeating a mutation is safe", async () => {
  const output = captureIo();
  const exitCode = await runCli(["restart", "--json"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "status") return createStatus("running");

      throw new Error("DeskCue host control request timed out.");
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.timeout);
  assert.equal(JSON.parse(output.read().stdout).error.retryable, false);
});

test("human Host failures cannot inject terminal control sequences", async () => {
  const output = captureIo();
  const exitCode = await runCli(["restart"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "status") return createStatus("running");

      throw new HostControlRejectedError(
        "busy",
        "Wait\u001b]0;spoofed\u0007\nthen retry.",
        false,
        { blockers: [{ code: "active\u001b[31m", message: "Turn\u001b]0;spoofed\u0007 is active." }] }
      );
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.refused);
  assert.doesNotMatch(output.read().stderr, /\u001b/u);
  assert.match(output.read().stderr, /Error: Wait then retry\./u);
  assert.match(output.read().stderr, /Turn is active\. \(active\)/u);
});

test("failed update status is an error in both text and JSON semantics", async () => {
  const output = captureIo();
  const failed = createStatus("running");

  failed.update.state = "failed";
  failed.update.lastError = "Manifest signature is invalid.";
  const exitCode = await runCli(["update", "--check", "--json"], {
    io: output.io,
    requestHost: async (method) => method === "status" ? createStatus("running") : failed
  });
  const result = JSON.parse(output.read().stdout);

  assert.equal(exitCode, CLI_EXIT_CODES.failure);
  assert.equal(result.ok, false);
  assert.match(result.message, /Manifest signature is invalid/u);
});

test("update progress uses action-oriented human copy", async () => {
  const output = captureIo();
  const available = createStatus("running");
  const applying = createStatus("running");

  available.update.availableVersion = "0.2.0";
  available.update.state = "available";
  applying.update.availableVersion = "0.2.0";
  applying.update.state = "applying";
  const exitCode = await runCli(["update"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "status") return createStatus("running");
      if (method === "update.check") return available;

      return applying;
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.match(output.read().stdout, /DeskCue is applying update 0\.2\.0\./u);
});

test("status treats a failed update operation as unhealthy", async () => {
  const output = captureIo();
  const failed = createStatus("running");

  failed.update.state = "failed";
  failed.update.lastError = "Manifest signature is invalid.";
  const exitCode = await runCli(["status", "--json"], {
    fetch: unavailableStatusFetch,
    io: output.io,
    requestHost: async () => failed
  });
  const result = JSON.parse(output.read().stdout);

  assert.equal(exitCode, CLI_EXIT_CODES.failure);
  assert.equal(result.ok, false);
  assert.match(result.message, /last update operation failed/u);
});

test("missing update feed has product-level copy instead of a raw HTTP error", async () => {
  const output = captureIo();
  const exitCode = await runCli(["update", "--check", "--json"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "status") return createStatus("running");

      throw new HostControlRejectedError(
        "download_failed",
        "Update source returned HTTP 404.",
        false
      );
    }
  });
  const result = JSON.parse(output.read().stdout);

  assert.equal(exitCode, CLI_EXIT_CODES.failure);
  assert.match(result.error.message, /requested update resource was not found/u);
  assert.equal(result.error.retryable, false);
});

test("doctor JSON exposes health and a compact runtime without capabilities", async () => {
  const output = captureIo();

  await runCli(["doctor", "--json"], {
    io: output.io,
    requestHost: async () => createStatus("running")
  });
  const result = JSON.parse(output.read().stdout);

  assert.equal(typeof result.data.health.summary.status, "string");
  assert.equal(result.data.runtime.daemon.state, "running");
  assert.equal("capabilities" in result.data.runtime, false);
  assert.equal("hostStatus" in result.data, false);
});

test("autostart reports an unknown supported state without calling it disabled", async () => {
  const output = captureIo();
  const status = createStatus("running");

  status.autostart.enabled = null;
  const exitCode = await runCli(["autostart", "status"], {
    io: output.io,
    requestHost: async () => status
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.match(output.read().stdout, /state is unknown/u);
});

test("unsupported Host capability is refused before dispatch", async () => {
  const output = captureIo();
  const status = createStatus("running");

  status.capabilities["update.check"] = {
    allowed: false,
    reason: "Updates are unavailable in this build."
  };

  const calls: HostControlMethod[] = [];
  const exitCode = await runCli(["update", "--check"], {
    io: output.io,
    requestHost: async (method) => {
      calls.push(method);
      return status;
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.refused);
  assert.deepEqual(calls, ["status"]);
  assert.match(output.read().stderr, /unavailable in this build/iu);
});

test("missing mutating Host capability fails closed", async () => {
  const output = captureIo();
  const status = createStatus("running");

  delete status.capabilities["daemon.restart"];
  const exitCode = await runCli(["restart"], {
    io: output.io,
    requestHost: async () => status
  });

  assert.equal(exitCode, CLI_EXIT_CODES.refused);
  assert.match(output.read().stderr, /did not advertise permission for daemon\.restart/u);
});

test("installer Host shutdown is idempotent when the Host is absent", async () => {
  const output = captureIo();
  const exitCode = await runCli(["host", "shutdown", "--wait"], {
    io: output.io,
    requestHost: async () => {
      const error = new Error("missing") as NodeJS.ErrnoException;

      error.code = "ENOENT";
      throw error;
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.match(output.read().stdout, /Host is stopped/u);
});

test("installer Host shutdown probes a missing-token endpoint before declaring absence", async () => {
  const output = captureIo();
  let probes = 0;
  const request: HostRequest = async () => {
    throw new HostControlTokenReadError(Object.assign(new Error("missing token"), { code: "ENOENT" }));
  };

  request.probeEndpoint = async () => {
    probes += 1;
    return true;
  };

  const exitCode = await runCli(["host", "shutdown", "--wait"], {
    io: output.io,
    requestHost: request
  });

  assert.equal(exitCode, CLI_EXIT_CODES.failure);
  assert.equal(probes, 1);
  assert.match(output.read().stderr, /token could not be read/iu);
});

test("installer Host shutdown accepts a missing token only after endpoint absence is stable", async () => {
  const output = captureIo();
  let probes = 0;
  const request: HostRequest = async () => {
    throw new HostControlTokenReadError(Object.assign(new Error("missing token"), { code: "ENOENT" }));
  };

  request.probeEndpoint = async () => {
    probes += 1;
    return false;
  };

  const exitCode = await runCli(["host", "shutdown", "--wait", "--timeout", "1000"], {
    io: output.io,
    requestHost: request
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.ok(probes >= 4);
});

test("installer Host shutdown never treats a typed Host rejection as endpoint absence", async () => {
  const output = captureIo();
  const exitCode = await runCli(["host", "shutdown", "--wait"], {
    io: output.io,
    requestHost: async () => {
      throw new HostControlRejectedError("EPIPE", "Host rejected the request.", false);
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.failure);
  assert.match(output.read().stderr, /Host rejected/iu);
});

test("installer Host shutdown fails closed when transport resets but the endpoint stays live", async () => {
  const output = captureIo();
  let statusCalls = 0;
  const request: HostRequest = async (method) => {
    if (method === "host.shutdown") return createStatus("running");

    statusCalls += 1;
    if (statusCalls === 1) return createStatus("running");

    const error = new Error("connection reset") as NodeJS.ErrnoException;

    error.code = "ECONNRESET";
    throw error;
  };

  request.probeEndpoint = async () => true;
  const exitCode = await runCli(["host", "shutdown", "--wait", "--timeout", "1000"], {
    io: output.io,
    requestHost: request
  });

  assert.equal(exitCode, CLI_EXIT_CODES.failure);
  assert.match(output.read().stderr, /connection reset/iu);
});

test("installer Host shutdown confirms absence after the committed connection closes without response", async () => {
  const output = captureIo();
  let shutdownCalls = 0;
  const request: HostRequest = async (method) => {
    if (method === "status" && shutdownCalls === 0) return createStatus("running");

    if (method === "host.shutdown") {
      shutdownCalls += 1;
      throw new HostControlConnectionClosedError();
    }

    throw new HostControlConnectionClosedError();
  };

  request.probeEndpoint = async () => false;
  const exitCode = await runCli(["host", "shutdown", "--wait", "--timeout", "1000"], {
    io: output.io,
    requestHost: request
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.equal(shutdownCalls, 1);
  assert.match(output.read().stdout, /Host is stopped/iu);
});

test("installer Host shutdown confirms absence when the endpoint closes before the request", async () => {
  const output = captureIo();
  let calls = 0;
  const exitCode = await runCli(["host", "shutdown", "--wait", "--timeout", "1000"], {
    io: output.io,
    requestHost: async () => {
      calls += 1;
      if (calls === 1) return createStatus("running");

      const error = new Error("stopped") as NodeJS.ErrnoException;

      error.code = "ENOENT";
      throw error;
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.ok(calls >= 4);
  assert.match(output.read().stdout, /Host is stopped/u);
});

test("installer Host shutdown retries when the endpoint reappears during absence confirmation", async () => {
  const output = captureIo();
  const calls: HostControlMethod[] = [];
  let shutdownCalls = 0;
  let statusCalls = 0;
  const exitCode = await runCli(["host", "shutdown", "--wait", "--timeout", "1000"], {
    io: output.io,
    requestHost: async (method) => {
      calls.push(method);
      if (method === "host.shutdown") {
        shutdownCalls += 1;
        if (shutdownCalls > 1) return createStatus("running");

        const error = new Error("endpoint closed") as NodeJS.ErrnoException;

        error.code = "EPIPE";
        throw error;
      }

      statusCalls += 1;
      if (statusCalls <= 2) return createStatus("running");

      const error = new Error("stopped") as NodeJS.ErrnoException;

      error.code = "ENOENT";
      throw error;
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.equal(shutdownCalls, 2);
  assert.deepEqual(calls.slice(0, 5), ["status", "host.shutdown", "status", "host.shutdown", "status"]);
  assert.ok(calls.slice(5).every((method) => method === "status"));
});

test("installer Host shutdown waits when a lost response already committed shutdown", async () => {
  const output = captureIo();
  let shutdownCalls = 0;
  let statusCalls = 0;
  const exitCode = await runCli(["host", "shutdown", "--wait", "--timeout", "1000"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "host.shutdown") {
        shutdownCalls += 1;
        const error = new Error("response pipe closed") as NodeJS.ErrnoException;

        error.code = "EPIPE";
        throw error;
      }

      statusCalls += 1;
      if (statusCalls === 1) return createStatus("running");

      if (statusCalls === 2) {
        const stopping = createStatus("running");

        stopping.host.state = "stopping";
        stopping.capabilities["host.shutdown"] = {
          allowed: false,
          reason: "DeskCue Host is already shutting down."
        };

        return stopping;
      }

      const error = new Error("stopped") as NodeJS.ErrnoException;

      error.code = "ENOENT";
      throw error;
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.equal(shutdownCalls, 1);
  assert.ok(statusCalls >= 5);
});

test("installer Host shutdown does not mistake a transient refusal for absence", async () => {
  const output = captureIo();
  const calls: HostControlMethod[] = [];
  let statusCalls = 0;
  const exitCode = await runCli(["host", "shutdown", "--wait", "--timeout", "1000"], {
    io: output.io,
    requestHost: async (method) => {
      calls.push(method);
      if (method === "host.shutdown") return createStatus("running");

      statusCalls += 1;
      if (statusCalls === 1) {
        const error = new Error("not listening yet") as NodeJS.ErrnoException;

        error.code = "ECONNREFUSED";
        throw error;
      }

      if (statusCalls === 2) return createStatus("running");

      const error = new Error("stopped") as NodeJS.ErrnoException;

      error.code = "ENOENT";
      throw error;
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.deepEqual(calls.slice(0, 4), ["status", "status", "host.shutdown", "status"]);
  assert.ok(calls.slice(4).every((method) => method === "status"));
});

test("installer Host shutdown confirms a post-request endpoint disappearance", async () => {
  const output = captureIo();
  let statusCalls = 0;
  const exitCode = await runCli(["host", "shutdown", "--wait", "--timeout", "1500"], {
    io: output.io,
    requestHost: async (method) => {
      if (method === "host.shutdown") return createStatus("running");

      statusCalls += 1;
      if (statusCalls === 1 || statusCalls === 3) return createStatus("running");

      const error = new Error(statusCalls === 2 ? "connection reset" : "stopped") as NodeJS.ErrnoException;

      error.code = statusCalls === 2 ? "ECONNRESET" : "ENOENT";
      throw error;
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.success);
  assert.ok(statusCalls >= 6);
  assert.match(output.read().stdout, /Host is stopped/u);
});

test("installer Host shutdown bounds a slow status poll by the requested deadline", async () => {
  const output = captureIo();
  const startedAt = Date.now();
  let callCount = 0;
  const exitCode = await runCli(["host", "shutdown", "--wait", "--timeout", "300"], {
    io: output.io,
    requestHost: async () => {
      callCount += 1;
      if (callCount <= 2) return createStatus("running");

      return new Promise(() => {});
    }
  });

  assert.equal(exitCode, CLI_EXIT_CODES.timeout);
  assert.ok(Date.now() - startedAt < 600);
  assert.match(output.read().stderr, /did not stop within 300ms/u);
});

test("unknown command writes usage diagnostics to stderr and exits 2", async () => {
  const output = captureIo();
  const exitCode = await runCli(["unknown"], { io: output.io });

  assert.equal(exitCode, CLI_EXIT_CODES.usage);
  assert.equal(output.read().stdout, "");
  assert.match(output.read().stderr, /Unknown command/u);
});

test("malformed global invocation attributes JSON usage errors to help", async () => {
  const output = captureIo();
  const exitCode = await runCli(["--json", "--bogus", "foo"], { io: output.io });
  const result = JSON.parse(output.read().stdout);

  assert.equal(exitCode, CLI_EXIT_CODES.usage);
  assert.equal(result.command, "help");
  assert.equal(result.ok, false);
});
