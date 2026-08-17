import assert from "node:assert/strict";
import test from "node:test";

import { extractCodexRuntimeContext } from "./codexRuntimeContext.ts";

test("extracts latest Codex runtime context", () => {
  const raw = [
    JSON.stringify({
      type: "turn_context",
      payload: {
        approval_policy: "on-request",
        model: "gpt-4.1",
        sandbox_policy: {
          type: "read-only"
        }
      }
    }),
    JSON.stringify({
      type: "turn_context",
      payload: {
        approval_policy: "never",
        model: "gpt-5",
        sandbox_policy: {
          type: "workspace-write"
        }
      }
    })
  ].join("\n");

  assert.deepEqual(extractCodexRuntimeContext(raw), {
    approvalPolicy: "never",
    model: "gpt-5",
    sandboxMode: "workspace-write"
  });
});

test("ignores unknown Codex runtime context values", () => {
  assert.equal(
    extractCodexRuntimeContext(
      JSON.stringify({
        type: "turn_context",
        payload: {
          approval_policy: "bad",
          model: "",
          sandbox_policy: {
            type: "bad"
          }
        }
      })
    ),
    null
  );
});
