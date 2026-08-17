import { spawn } from "node:child_process";

export type ExternalUrlLaunchSpec = {
  args: string[];
  command: string;
  env?: NodeJS.ProcessEnv;
};

export function getCodexDesktopThreadLaunchSpec(
  threadUrl: string,
  platform = process.platform
): ExternalUrlLaunchSpec {
  const parsed = new URL(threadUrl);
  if (parsed.protocol !== "codex:" || parsed.hostname !== "threads" || !parsed.pathname.slice(1)) {
    throw new Error("Expected a Codex Desktop thread URL.");
  }

  if (platform === "win32") {
    return {
      command: "explorer.exe",
      args: [threadUrl]
    };
  }

  if (platform === "darwin") {
    return { command: "open", args: [threadUrl] };
  }

  if (platform === "linux") {
    return { command: "xdg-open", args: [threadUrl] };
  }

  throw new Error(`Opening Codex Desktop chats is not supported on ${platform}.`);
}

export async function openCodexDesktopThread(sourceSessionId: string): Promise<void> {
  const threadUrl = `codex://threads/${encodeURIComponent(sourceSessionId)}`;
  const spec = getCodexDesktopThreadLaunchSpec(threadUrl);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      detached: true,
      env: spec.env,
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
