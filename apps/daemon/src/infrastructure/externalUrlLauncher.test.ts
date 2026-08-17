import assert from "node:assert/strict";
import test from "node:test";

import { getCodexDesktopThreadLaunchSpec } from "./externalUrlLauncher.ts";

const threadUrl = "codex://threads/thread-123";

test("builds an OS launcher command for a Codex Desktop thread", () => {
  assert.deepEqual(
    getCodexDesktopThreadLaunchSpec(threadUrl, "darwin"),
    { command: "open", args: [threadUrl] }
  );
  assert.deepEqual(
    getCodexDesktopThreadLaunchSpec(threadUrl, "linux"),
    { command: "xdg-open", args: [threadUrl] }
  );

  const windowsSpec = getCodexDesktopThreadLaunchSpec(threadUrl, "win32");
  assert.equal(windowsSpec.command, "explorer.exe");
  assert.deepEqual(windowsSpec.args, [threadUrl]);
  assert.equal(windowsSpec.env, undefined);
});

test("refuses a non-Codex Desktop URL", () => {
  assert.throws(
    () => getCodexDesktopThreadLaunchSpec("https://example.test", "win32"),
    /Expected a Codex Desktop thread URL/
  );
});
