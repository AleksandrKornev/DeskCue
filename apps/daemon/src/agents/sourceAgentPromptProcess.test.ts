import assert from "node:assert/strict"
import test from "node:test"

import { runSourcePromptProcessLifecycle } from "./sourceAgentPromptProcess.ts"

test("releases the current process before spawning its replacement", async () => {
  const events: string[] = []
  const spawnError = new Error("stop after spawn")
  const callbacks = {
    spawnProcess: () => {
      events.push("spawn")
      throw spawnError
    }
  } as never
  const lifecycle = {
    beforeProcessStart: async () => {
      events.push("release")
    },
    command: "codex",
    env: {},
    session: { id: "session-1" },
    spawnSpec: {},
    workspace: { path: "workspace" }
  } as never

  await assert.rejects(runSourcePromptProcessLifecycle(callbacks, lifecycle), spawnError)
  assert.deepEqual(events, ["release", "spawn"])
})
