import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClaudeBackgroundStopCommand,
  buildClaudeCliEnvironment,
  findClaudeBackgroundAgent,
  listClaudeBackgroundAgents,
  requestClaudeBackgroundStop,
  resolveClaudeBackgroundControlCapability
} from "./claudeBackgroundControl.ts";
import type { ClaudeBackgroundCommand } from "./claudeBackgroundControl.ts";

const SOURCE_SESSION_ID = "a0f1b2c3-d4e5-4678-9abc-def012345678";

test("parses Claude background agents and exposes exact background stop capability", async () => {
  const capability = await resolveClaudeBackgroundControlCapability(SOURCE_SESSION_ID, {
    execute: async () => ({
      stdout: JSON.stringify([
        {
          id: "job-alpha",
          sessionId: "a0f1b2c3-d4e5-4678-9abc-def012345679",
          kind: "background",
          state: "working",
          pid: 101
        },
        {
          id: "job-beta",
          sessionId: SOURCE_SESSION_ID,
          kind: "background",
          state: "blocked",
          pid: 202,
          waitingFor: "input needed"
        }
      ])
    })
  });

  assert.deepEqual(capability, {
    kind: "claude_background_stop",
    sourceSessionId: SOURCE_SESSION_ID,
    jobId: "job-beta",
    state: "blocked",
    pid: 202
  });
});

test("does not grant stop capability to an interactive session with the same source session id", async () => {
  const capability = await resolveClaudeBackgroundControlCapability(SOURCE_SESSION_ID, {
    execute: async () => ({
      stdout: JSON.stringify([
        {
          sessionId: SOURCE_SESSION_ID,
          kind: "interactive",
          startedAt: 1_700_000_000_000
        }
      ])
    })
  });

  assert.deepEqual(capability, {
    kind: "observe_only",
    sourceSessionId: SOURCE_SESSION_ID,
    reason: "interactive_session"
  });
});

test("does not match source session identifiers by prefix", async () => {
  const capability = await resolveClaudeBackgroundControlCapability(SOURCE_SESSION_ID, {
    execute: async () => ({
      stdout: JSON.stringify([
        {
          id: "job-alpha",
          sessionId: `${SOURCE_SESSION_ID}-different`,
          kind: "background",
          state: "working"
        }
      ])
    })
  });

  assert.deepEqual(capability, {
    kind: "observe_only",
    sourceSessionId: SOURCE_SESSION_ID,
    reason: "session_not_listed"
  });
});

test("refuses an ambiguous background mapping instead of selecting a short job id", async () => {
  const capability = await resolveClaudeBackgroundControlCapability(SOURCE_SESSION_ID, {
    execute: async () => ({
      stdout: JSON.stringify([
        {
          id: "job-alpha",
          sessionId: SOURCE_SESSION_ID,
          kind: "background",
          state: "working"
        },
        {
          id: "job-beta",
          sessionId: SOURCE_SESSION_ID,
          kind: "background",
          state: "blocked"
        }
      ])
    })
  });

  assert.deepEqual(capability, {
    kind: "observe_only",
    sourceSessionId: SOURCE_SESSION_ID,
    reason: "ambiguous_background_session"
  });
});

test("rejects malformed agent JSON without throwing", async () => {
  const result = await listClaudeBackgroundAgents({
    execute: async () => ({ stdout: "{not-json}" })
  });

  assert.deepEqual(result, {
    kind: "command_unavailable",
    reason: "invalid_json"
  });
});

test("finds one completed background chat through the explicit bounded attach lookup", async () => {
  const calls: ClaudeBackgroundCommand[] = [];
  const agent = await findClaudeBackgroundAgent(SOURCE_SESSION_ID, {
    executable: "claude",
    execute: async (command) => {
      calls.push(command);
      return {
        stdout: JSON.stringify([
          {
            id: "job-completed",
            sessionId: SOURCE_SESSION_ID,
            kind: "background",
            state: "done"
          }
        ])
      };
    }
  });

  assert.equal(agent?.jobId, "job-completed");
  assert.equal(agent?.state, "done");
  assert.deepEqual(calls[0]?.args, ["agents", "--all", "--json"]);
});

test("reports command unavailability separately from a missing source session", async () => {
  const capability = await resolveClaudeBackgroundControlCapability(SOURCE_SESSION_ID, {
    execute: async () => {
      throw new Error("claude is not available");
    }
  });

  assert.deepEqual(capability, {
    kind: "observe_only",
    sourceSessionId: SOURCE_SESSION_ID,
    reason: "control_command_unavailable"
  });
});

test("requests claude stop only after a fresh exact background session lookup", async () => {
  const calls: ClaudeBackgroundCommand[] = [];
  const result = await requestClaudeBackgroundStop(SOURCE_SESSION_ID, {
    executable: "C:\\tools\\claude.exe",
    timeoutMs: 1_234,
    execute: async (command) => {
      calls.push(command);
      if (command.args[0] === "agents") {
        return {
          stdout: JSON.stringify([
            {
              id: "abc123",
              sessionId: SOURCE_SESSION_ID,
              kind: "background",
              state: "working",
              pid: 444
            }
          ])
        };
      }

      assert.deepEqual(command.args, ["stop", "abc123"]);
      return { stdout: "stopping" };
    }
  });

  assert.deepEqual(result, {
    kind: "stop_requested",
    sourceSessionId: SOURCE_SESSION_ID,
    jobId: "abc123"
  });
  assert.deepEqual(calls, [
    {
      executable: "C:\\tools\\claude.exe",
      args: ["agents", "--json"],
      timeoutMs: 1_234
    },
    {
      executable: "C:\\tools\\claude.exe",
      args: ["stop", "abc123"],
      timeoutMs: 1_234
    }
  ]);
});

test("does not issue stop for terminal, unknown, or unsafe background jobs", async () => {
  const calls: ClaudeBackgroundCommand[] = [];
  const result = await requestClaudeBackgroundStop(SOURCE_SESSION_ID, {
    execute: async (command) => {
      calls.push(command);
      return {
        stdout: JSON.stringify([
          {
            id: "bad job id",
            sessionId: SOURCE_SESSION_ID,
            kind: "background",
            state: "done"
          }
        ])
      };
    }
  });

  assert.equal(result.kind, "control_unavailable");
  assert.deepEqual(
    calls.map((call) => call.args),
    process.platform === "win32"
      ? [["/d", "/s", "/c", "claude.cmd agents --json"]]
      : [["agents", "--json"]]
  );
});

test("builds a structured stop command and rejects unsafe job identifiers", () => {
  const command = buildClaudeBackgroundStopCommand({ jobId: "safe_job-1" });
  if (process.platform === "win32") {
    assert.deepEqual(command, {
      executable: process.env.ComSpec?.trim() || "cmd.exe",
      args: ["/d", "/s", "/c", "claude.cmd stop safe_job-1"],
      timeoutMs: 5_000
    });
  } else {
    assert.deepEqual(command, {
      executable: "claude",
      args: ["stop", "safe_job-1"],
      timeoutMs: 5_000
    });
  }
  assert.equal(buildClaudeBackgroundStopCommand({ jobId: "job; rm -rf /" }), null);
});

test("does not pass an empty Claude config directory to the Claude CLI", () => {
  const environment = buildClaudeCliEnvironment({
    CLAUDE_CONFIG_DIR: "   ",
    PATH: "C:\\tools",
    USERPROFILE: "C:\\Users\\example"
  });

  assert.equal(environment.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(environment.PATH, "C:\\tools");
  assert.equal(environment.USERPROFILE, "C:\\Users\\example");
});
