import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import type { SessionDetail } from "@deskcue/protocol";

import {
  buildSessionEnvironment,
  createSessionPipe,
  forwardSessionInput,
  getExitedSessionStatus
} from "./sessionProcess.ts";
import type { RunningChild } from "./sessionProcess.ts";
import { createWindowsSurvivingPipeLauncher } from "./windowsSurvivingPipeLauncher.ts";

const execFileAsync = promisify(execFile);

async function waitForFile(filePath: string) {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error("Timed out waiting for surviving child marker.");
}

async function waitForPipeExit(child: RunningChild) {
  return await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for pipe exit.")), 5_000);

    child.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      resolve(exitCode);
    });
  });
}

test("keeps a successful Claude one-shot resume attached and ready for the next prompt", () => {
  assert.equal(
    getExitedSessionStatus(
      {
        adapterId: "claude-code",
        command: "claude --resume source-session --print continue",
        sourceSessionId: "source-session",
        status: "running"
      },
      0
    ),
    "read_only"
  );
});

test("keeps a successful Codex one-shot resume attached and ready for the next prompt", () => {
  assert.equal(
    getExitedSessionStatus(
      {
        adapterId: "codex",
        command: "codex -c check_for_update_on_startup=false exec resume source-session continue",
        sourceSessionId: "source-session",
        status: "running"
      },
      0
    ),
    "read_only"
  );
});

test("keeps a transcript-completed Codex shell ready when transport termination exits non-zero", () => {
  assert.equal(
    getExitedSessionStatus(
      {
        adapterId: "codex",
        command: "codex -c check_for_update_on_startup=false exec resume source-session continue",
        sourceSessionId: "source-session",
        status: "read_only"
      },
      1
    ),
    "read_only"
  );
});

test("uses the Codex source transport submit sequence through the process policy", () => {
  const written: string[] = [];
  const child = {
    write(value: string) {
      written.push(value);
    }
  } as RunningChild;

  forwardSessionInput(
    {
      adapterId: "codex",
      command: "codex exec resume source-session",
      sourceSessionId: "source-session"
    } as SessionDetail,
    child,
    "first line\nsecond line"
  );

  assert.deepEqual(written, ["first line second line\t"]);
});

test("keeps generic session input on the default PTY submit policy", () => {
  const written: string[] = [];
  const child = {
    write(value: string) {
      written.push(value);
    }
  } as RunningChild;

  forwardSessionInput(
    {
      adapterId: "generic-cli",
      command: "node interactive.js",
      sourceSessionId: null
    } as SessionDetail,
    child,
    "continue"
  );

  assert.deepEqual(written, [`continue${process.platform === "win32" ? "\r\n" : "\n"}`]);
});

test("does not pass blank DeskCue CLI configuration paths to child processes", () => {
  const environment = buildSessionEnvironment(
    {
      CLAUDE_CONFIG_DIR: "  ",
      CODEX_HOME: "",
      DESKCUE_CODEX_MODEL: "\t",
      DESKCUE_CODEX_PATH: ""
    },
    false
  );

  assert.equal(environment.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(environment.CODEX_HOME, undefined);
  assert.equal(environment.DESKCUE_CODEX_MODEL, undefined);
  assert.equal(environment.DESKCUE_CODEX_PATH, undefined);
});

test("runs a one-shot generic command through the session PTY", async () => {
  const helperUrl = new URL("./sessionProcess.ts", import.meta.url).href;
  const code = `
    const { createSessionPty } = await import(${JSON.stringify(helperUrl)});
    const child = createSessionPty("echo DESKCUE_PTY_OK", process.cwd(), {});
    let output = "";

    const timeout = setTimeout(() => {
      child.kill();
      console.error("Timed out waiting for PTY command to exit.");
      process.exit(2);
    }, 5000);

    child.onData((chunk) => {
      output += chunk;
    });
    child.onExit((event) => {
      clearTimeout(timeout);
      console.log(JSON.stringify({
        exitCode: event.exitCode,
        output
      }));
      process.exit(0);
    });
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--conditions=deskcue-source", "--import", "tsx", "-e", code],
    {
      cwd: new URL("../../../../..", import.meta.url)
    }
  );
  const result = JSON.parse(stdout.trim()) as {
    exitCode: number;
    output: string;
  };

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /DESKCUE_PTY_OK/);
});

test("runs a one-shot process without a PTY and forwards stdout", async () => {
  const child = createSessionPipe(process.cwd(), {}, {
    file: process.execPath,
    args: ["-e", "process.stdout.write('DESKCUE_PIPE_OK')"],
    transport: "pipe"
  });
  let output = "";

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Timed out waiting for pipe command to exit."));
    }, 5000);

    child.onData((chunk) => {
      output += chunk;
    });
    child.onExit((event) => {
      clearTimeout(timeout);
      resolve(event.exitCode);
    });
  });

  assert.equal(exitCode, 0);
  assert.equal(output, "DESKCUE_PIPE_OK");
});

test("survive-parent-exit pipe process completes after its DeskCue parent exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-surviving-pipe-"));
  const markerPath = join(directory, "completed.marker");
  const moduleUrl = new URL("./sessionProcess.ts", import.meta.url).href;
  const childCode = `
    setTimeout(() => {
      require("node:fs").writeFileSync(process.argv[1], "completed");
    }, 300);
  `;
  const parentCode = `
    import { createSessionPipe } from ${JSON.stringify(moduleUrl)};
    const child = createSessionPipe(process.cwd(), {}, {
      file: process.execPath,
      args: ["-e", ${JSON.stringify(childCode)}, ${JSON.stringify(markerPath)}],
      surviveParentExit: true,
      transport: "pipe"
    });

    await child.startupReady;
    child.detachFromDeskCue?.();
  `;

  try {
    await execFileAsync(
      process.execPath,
      ["--conditions=deskcue-source", "--import", "tsx", "--input-type=module", "-e", parentCode],
      { cwd: new URL("../../../../..", import.meta.url) }
    );

    await waitForFile(markerPath);
    await access(markerPath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("keeps the Windows surviving pipe payload out of launcher argv", () => {
  const prompt = "sensitive prompt that must not persist";
  const launcher = createWindowsSurvivingPipeLauncher({
    args: ["-e", "process.exit(0)", prompt],
    file: process.execPath
  });

  assert.doesNotMatch([launcher.file, ...launcher.args].join(" "), new RegExp(prompt));
  assert.match(launcher.payload, new RegExp(prompt));
});

test("Windows surviving pipe confirms nested startup", {
  skip: process.platform !== "win32"
}, async () => {
  const prompt = "sensitive prompt that must not persist";
  const child = createSessionPipe(process.cwd(), {}, {
    args: ["-e", "setTimeout(() => process.exit(0), 250)", prompt],
    file: process.execPath,
    surviveParentExit: true,
    transport: "pipe"
  });

  assert.ok(child.startupReady);
  await child.startupReady;
  await waitForPipeExit(child);
});

test("Windows surviving pipe reports an outer spawn error", {
  skip: process.platform !== "win32"
}, async () => {
  const missingCwd = join(tmpdir(), `deskcue-missing-cwd-${Date.now()}`);
  const child = createSessionPipe(missingCwd, {}, {
    args: ["-e", "process.exit(0)"],
    file: process.execPath,
    surviveParentExit: true,
    transport: "pipe"
  });
  let output = "";

  child.onData((chunk) => {
    output += chunk;
  });

  await assert.rejects(child.startupReady!, /Failed to start process launcher/);
  assert.equal(await waitForPipeExit(child), 1);
  assert.match(output, /Failed to start process/);
});

test("Windows surviving pipe reports bounded safe nested startup diagnostics before exit", {
  skip: process.platform !== "win32"
}, async () => {
  const secretPrompt = "SECRET_PROMPT_MUST_NOT_APPEAR";
  const child = createSessionPipe(process.cwd(), {}, {
    args: [secretPrompt],
    file: join(tmpdir(), `missing-agent-${Date.now()}.exe`),
    surviveParentExit: true,
    transport: "pipe"
  });
  let output = "";

  child.onData((chunk) => {
    output += chunk;
  });

  await assert.rejects(child.startupReady!, /Failed to start process: ENOENT/);
  assert.equal(await waitForPipeExit(child), 1);
  assert.match(output, /Failed to start process: ENOENT/);
  assert.doesNotMatch(output, /SECRET_PROMPT_MUST_NOT_APPEAR/);
  assert.ok(output.length <= 2_049);
});

test("Windows surviving pipe kill terminates its full tree", {
  skip: process.platform !== "win32"
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "deskcue-tree-kill-"));
  const startedPath = join(directory, "started.marker");
  const markerPath = join(directory, "orphan.marker");
  const child = createSessionPipe(process.cwd(), {}, {
    args: [
      "-e",
      "require('node:fs').writeFileSync(process.argv[1], 'started'); " +
        "setTimeout(() => require('node:fs').writeFileSync(process.argv[2], 'orphan'), 750)",
      startedPath,
      markerPath
    ],
    file: process.execPath,
    surviveParentExit: true,
    transport: "pipe"
  });

  try {
    assert.ok(child.startupReady);
    await child.startupReady;
    await waitForFile(startedPath);
    child.kill();
    await waitForPipeExit(child);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await assert.rejects(access(markerPath));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("replays output and exit state when a pipe process finishes before subscription", async () => {
  const child = createSessionPipe(process.cwd(), {}, {
    file: process.execPath,
    args: ["-e", "process.stdout.write('DESKCUE_EARLY_PIPE_OK')"],
    transport: "pipe"
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  let output = "";

  const exitCode = await new Promise<number | null>((resolve) => {
    child.onData((chunk) => {
      output += chunk;
    });

    child.onExit((event) => resolve(event.exitCode));
  });

  assert.equal(exitCode, 0);
  assert.equal(output, "DESKCUE_EARLY_PIPE_OK");
});

async function runPtyCommand(command: string) {
  const helperUrl = new URL("./sessionProcess.ts", import.meta.url).href;
  const code = `
    const { createSessionPty } = await import(${JSON.stringify(helperUrl)});
    const child = createSessionPty(${JSON.stringify(command)}, process.cwd(), {});
    let output = "";

    const timeout = setTimeout(() => {
      child.kill();
      console.error("Timed out waiting for PTY command to exit.");
      process.exit(2);
    }, 5000);

    child.onData((chunk) => {
      output += chunk;
    });
    child.onExit((event) => {
      clearTimeout(timeout);
      console.log(JSON.stringify({
        exitCode: event.exitCode,
        output
      }));
      process.exit(0);
    });
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--conditions=deskcue-source", "--import", "tsx", "-e", code],
    {
      cwd: new URL("../../../../..", import.meta.url)
    }
  );

  return JSON.parse(stdout.trim()) as {
    exitCode: number;
    output: string;
  };
}

test("normalizes dumb TERM for interactive PTY commands", async () => {
  const command =
    process.platform === "win32"
      ? `${JSON.stringify(process.execPath)} -e "console.log(process.env.TERM)"`
      : `${JSON.stringify(process.execPath)} -e 'console.log(process.env.TERM)'`;
  const previousTerm = process.env.TERM;

  process.env.TERM = "dumb";

  try {
    const result = await runPtyCommand(command);

    assert.equal(result.exitCode, 0);
    assert.match(result.output, /xterm-256color/);
  } finally {
    if (previousTerm === undefined) {
      delete process.env.TERM;
    } else {
      process.env.TERM = previousTerm;
    }
  }
});

test("preserves explicit TERM override for interactive PTY commands", async () => {
  const command =
    process.platform === "win32"
      ? `${JSON.stringify(process.execPath)} -e "console.log(process.env.TERM)"`
      : `${JSON.stringify(process.execPath)} -e 'console.log(process.env.TERM)'`;
  const helperUrl = new URL("./sessionProcess.ts", import.meta.url).href;
  const code = `
    process.env.TERM = "dumb";
    const { createSessionPty } = await import(${JSON.stringify(helperUrl)});
    const child = createSessionPty(${JSON.stringify(command)}, process.cwd(), { TERM: "screen-256color" });
    let output = "";

    const timeout = setTimeout(() => {
      child.kill();
      console.error("Timed out waiting for PTY command to exit.");
      process.exit(2);
    }, 5000);

    child.onData((chunk) => {
      output += chunk;
    });
    child.onExit((event) => {
      clearTimeout(timeout);
      console.log(JSON.stringify({
        exitCode: event.exitCode,
        output
      }));
      process.exit(0);
    });
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--conditions=deskcue-source", "--import", "tsx", "-e", code],
    {
      cwd: new URL("../../../../..", import.meta.url)
    }
  );
  const result = JSON.parse(stdout.trim()) as {
    exitCode: number;
    output: string;
  };

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /screen-256color/);
});

test("runs a generic command with a quoted absolute script path through the session PTY", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows command quoting behavior only applies on win32.");
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-quoted-command-"));

  try {
    const scriptPath = join(tempDir, "quoted-script.cjs");

    await writeFile(scriptPath, `console.log("DESKCUE_QUOTED_PATH_OK");\n`, "utf8");

    const result = await runPtyCommand(`node "${scriptPath}"`);

    assert.equal(result.exitCode, 0);
    assert.match(result.output, /DESKCUE_QUOTED_PATH_OK/);
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("terminates a running generic command without relying on native PTY kill", async () => {
  const command =
    process.platform === "win32"
      ? `${JSON.stringify(process.execPath)} -e "setInterval(() => {}, 1000)"`
      : `${JSON.stringify(process.execPath)} -e 'setInterval(() => {}, 1000)'`;
  const helperUrl = new URL("./sessionRunner.ts", import.meta.url).href;
  const code = `
    const { SessionRunner } = await import(${JSON.stringify(helperUrl)});
    const runner = new SessionRunner();
    const child = runner.spawnProcess({
      command: ${JSON.stringify(command)},
      cwd: process.cwd(),
      env: {},
      sessionId: "integration-session"
    });

    const timeout = setTimeout(() => {
      console.error("Timed out waiting for PTY command to terminate.");
      process.exit(2);
    }, 8000);

    process.on("unhandledRejection", (reason) => {
      clearTimeout(timeout);
      console.error(reason instanceof Error ? reason.stack : String(reason));
      process.exit(3);
    });

    child.onExit((event) => {
      clearTimeout(timeout);
      console.log(JSON.stringify({
        exitCode: event.exitCode
      }));
      process.exit(0);
    });

    setTimeout(() => {
      void runner.killChild("integration-session", child, "integration-test");
    }, 500);
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--conditions=deskcue-source", "--import", "tsx", "-e", code],
    {
      cwd: new URL("../../../../..", import.meta.url)
    }
  );
  const result = JSON.parse(stdout.trim()) as {
    exitCode: number;
  };

  assert.notEqual(result.exitCode, undefined);
});

test("uses Escape for Codex and Claude terminal interrupts", async () => {
  const { requestSessionPtyInterrupt } = await import("./sessionProcess.ts");
  const written: string[] = [];
  const child = {
    write(value: string) {
      written.push(value);
    }
  } as RunningChild;

  const codexKey = requestSessionPtyInterrupt(
    {
      adapterId: "codex",
      command: "codex",
      status: "running"
    } as SessionDetail,
    child
  );
  const claudeKey = requestSessionPtyInterrupt(
    {
      adapterId: "claude-code",
      command: "claude",
      status: "running"
    } as SessionDetail,
    child
  );

  assert.deepEqual(written, ["\x1b", "\x1b"]);
  assert.equal(codexKey, "Escape");
  assert.equal(claudeKey, "Escape");
});

test("does not fabricate a generic terminal interrupt", async () => {
  const { requestSessionPtyInterrupt } = await import("./sessionProcess.ts");
  let written = "";
  const child = {
    write(value: string) {
      written = value;
    }
  } as RunningChild;

  const interruptKey = requestSessionPtyInterrupt(
    {
      adapterId: "generic-cli",
      command: "npm run test",
      status: "running"
    } as SessionDetail,
    child
  );

  assert.equal(written, "");
  assert.equal(interruptKey, null);
});

test("delivers Escape to an interactive managed PTY command", async () => {
  const inputProbe =
    "process.stdin.setRawMode(true); process.stdin.resume(); console.log('DESKCUE_PTY_READY'); process.stdin.on('data', (chunk) => { if (chunk.toString() === '\\x1b') { console.log('DESKCUE_PTY_ESCAPE'); process.exit(0); } });";
  const helperUrl = new URL("./sessionProcess.ts", import.meta.url).href;
  const code = `
    const { createSessionPty, requestSessionPtyInterrupt } = await import(${JSON.stringify(helperUrl)});
    const child = createSessionPty("", process.cwd(), {}, {
      file: ${JSON.stringify(process.execPath)},
      args: ["-e", ${JSON.stringify(inputProbe)}]
    });
    let output = "";
    let interruptRequested = false;

    const timeout = setTimeout(() => {
      child.kill();
      console.error("Timed out waiting for PTY Escape.");
      process.exit(2);
    }, 8000);

    child.onData((chunk) => {
      output += chunk;
      if (!interruptRequested && output.includes("DESKCUE_PTY_READY")) {
        interruptRequested = true;
        requestSessionPtyInterrupt({ adapterId: "codex", command: "codex" }, child);
      }
    });
    child.onExit((event) => {
      clearTimeout(timeout);
      console.log(JSON.stringify({ exitCode: event.exitCode, output }));
      process.exit(0);
    });
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--conditions=deskcue-source", "--import", "tsx", "-e", code],
    {
      cwd: new URL("../../../../..", import.meta.url)
    }
  );
  const result = JSON.parse(stdout.trim()) as {
    exitCode: number;
    output: string;
  };

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /DESKCUE_PTY_ESCAPE/);
});
