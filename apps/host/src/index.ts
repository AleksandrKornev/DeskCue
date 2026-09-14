import {
  readOrCreateHostControlToken,
  requestHostControl,
  resolveHostControlEndpoint,
  resolveHostControlPaths
} from "@deskcue/host-control";

import { createHostControlServer } from "./controlServer.ts";
import { loadHostEnvFiles } from "./envFiles.ts";
import { HostApplication } from "./hostApplication.ts";
import { HostRuntime } from "./hostRuntime.ts";

function isAddressInUseError(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === "EADDRINUSE";
}

async function confirmExistingHost(paths: ReturnType<typeof resolveHostControlPaths>) {
  const response = await requestHostControl({
    paths,
    request: { method: "status" },
    timeoutMs: 1_500
  });

  return response.ok;
}

async function runHost() {
  loadHostEnvFiles();
  const paths = resolveHostControlPaths();
  const token = readOrCreateHostControlToken(paths.controlTokenFilePath);
  const endpoint = resolveHostControlEndpoint(token, paths);
  const runtime = new HostRuntime({ paths });
  const controlServer = createHostControlServer({
    endpoint,
    handle: (request) => runtime.handle(request),
    token
  });

  try {
    await controlServer.listen();
  } catch (error) {
    if (isAddressInUseError(error) && await confirmExistingHost(paths).catch(() => false)) return;

    throw error;
  }

  const application = new HostApplication(runtime, controlServer);

  try {
    await application.start();
  } catch (error) {
    await application.abortStart(error);
  }
}

runHost().catch((error) => {
  process.stderr.write(`DeskCue Host failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
