import { config } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(cliRoot, "../..");

function uniquePaths(filePaths: string[]) {
  return Array.from(new Set(filePaths.map((filePath) => resolve(filePath))));
}

export function loadCliEnvFiles() {
  config({
    override: false,
    path: uniquePaths([
      join(repoRoot, ".env.local"),
      join(repoRoot, ".env"),
      join(cliRoot, ".env.local"),
      join(cliRoot, ".env"),
      join(process.cwd(), ".env.local"),
      join(process.cwd(), ".env")
    ]),
    quiet: true
  });
}
