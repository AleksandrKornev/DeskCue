import { config } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type LoadHostEnvFilesOptions = {
  env?: NodeJS.ProcessEnv;
  moduleUrl?: string;
};

function resolveRepoRoot(moduleUrl: string) {
  const hostRoot = resolve(dirname(fileURLToPath(moduleUrl)), "..");

  return resolve(hostRoot, "../..");
}

export function loadHostEnvFiles({
  env = process.env,
  moduleUrl = import.meta.url
}: LoadHostEnvFilesOptions = {}) {
  if (env.DESKCUE_DISTRIBUTION_MODE === "installed") return;

  const repoRoot = resolveRepoRoot(moduleUrl);

  config({
    override: false,
    path: [join(repoRoot, ".env.local"), join(repoRoot, ".env")],
    processEnv: env,
    quiet: true
  });
}
