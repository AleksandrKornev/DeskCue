#!/usr/bin/env node

import { loadCliEnvFiles } from "./envFiles.ts";
import { runCli } from "./runCli.ts";

loadCliEnvFiles();

const abortController = new AbortController();

process.once("SIGINT", () => abortController.abort());

process.once("SIGTERM", () => abortController.abort());

process.exitCode = await runCli(process.argv.slice(2), {
  signal: abortController.signal
});
