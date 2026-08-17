import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const child = spawn(
  process.execPath,
  [playwrightCli, "test", ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      DESKCUE_E2E_BASE_URL:
        process.env.DESKCUE_E2E_BASE_URL ?? "http://127.0.0.1:4100",
      DESKCUE_E2E_REQUIRE_EXECUTED: "1"
    },
    stdio: "inherit"
  }
);

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Playwright terminated by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
