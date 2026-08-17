import { config } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const daemonRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(daemonRoot, "../..");

function uniquePaths(filePaths: string[]) {
  return Array.from(new Set(filePaths.map((filePath) => resolve(filePath))));
}

export function loadEnvFiles(filePaths: string[]) {
  config({
    override: false,
    path: uniquePaths(filePaths),
    quiet: true
  });
}

export function loadDaemonEnvFiles() {
  loadEnvFiles([
    join(repoRoot, ".env.local"),
    join(repoRoot, ".env"),
    join(daemonRoot, ".env.local"),
    join(daemonRoot, ".env"),
    join(process.cwd(), ".env.local"),
    join(process.cwd(), ".env")
  ]);
}
