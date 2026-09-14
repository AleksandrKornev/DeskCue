#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runPayloadSmoke,
  validatePayloadContents,
  verifyPayloadManifest
} from "./payload-lib.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const argumentsToRead = process.argv.slice(2);
const skipSmokeIndex = argumentsToRead.indexOf("--skip-smoke");
const skipSmoke = skipSmokeIndex >= 0;
if (skipSmoke) argumentsToRead.splice(skipSmokeIndex, 1);
if (argumentsToRead.length > 1) {
  throw new Error("Usage: verify-payload.mjs [payload-path] [--skip-smoke]");
}

const payloadRoot = resolve(argumentsToRead[0] ?? resolve(scriptDirectory, "dist", "payload"));
validatePayloadContents(payloadRoot);
const manifest = verifyPayloadManifest(payloadRoot);
if (!skipSmoke) runPayloadSmoke(payloadRoot);

process.stdout.write(
  `Verified DeskCue ${manifest.appVersion} Windows ${manifest.architecture} payload (${manifest.files.length} files).\n`
);
