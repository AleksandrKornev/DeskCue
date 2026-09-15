#!/usr/bin/env node

import { resolve } from "node:path";

import { validateLinuxPayload, verifyLinuxPayloadManifest } from "./payload-lib.mjs";
import { runLinuxPayloadSmoke } from "./payload-smoke.mjs";

const payloadRoot = resolve(process.argv[2] ?? "");
const architecture = process.argv[3] ?? process.arch;

if (architecture !== "x64" && architecture !== "arm64") throw new Error("Architecture must be x64 or arm64.");

validateLinuxPayload(payloadRoot, architecture);
verifyLinuxPayloadManifest(payloadRoot, { architecture });
runLinuxPayloadSmoke(payloadRoot, architecture);
process.stdout.write(`Verified Linux ${architecture} payload: ${payloadRoot}\n`);
