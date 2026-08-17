import {
  CLOUD_RELAY_V1_CONTRACT_FIXTURES,
  CLOUD_RELAY_V1_CONTRACT_MANIFEST
} from "../dist/index.js";

process.stdout.write(`${JSON.stringify({
  manifest: CLOUD_RELAY_V1_CONTRACT_MANIFEST,
  fixtures: CLOUD_RELAY_V1_CONTRACT_FIXTURES
}, null, 2)}\n`);
