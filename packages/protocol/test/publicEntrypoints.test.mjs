import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_RELAY_PROTOCOL_VERSION as rootCloudProtocolVersion,
  parseCreateSessionInput as parseRootCreateSessionInput,
  parseUpdateNotificationSettingsInput as parseRootNotificationSettings
} from "@deskcue/protocol";
import {
  CLOUD_RELAY_PROTOCOL_VERSION,
  CLOUD_RELAY_V1_CONTRACT_MANIFEST,
  parseCloudPreviewClientJson
} from "@deskcue/protocol/cloud";
import {
  parseRegisterPushSubscriptionInput,
  parseUpdateNotificationSettingsInput
} from "@deskcue/protocol/notifications";
import { parseCreateSessionInput } from "@deskcue/protocol/sessions";

test("public protocol subpaths expose the same stable contracts as the root entrypoint", () => {
  assert.equal(CLOUD_RELAY_PROTOCOL_VERSION, rootCloudProtocolVersion);
  assert.equal(CLOUD_RELAY_V1_CONTRACT_MANIFEST.manifestVersion, 1);
  assert.equal(parseCreateSessionInput, parseRootCreateSessionInput);
  assert.equal(parseUpdateNotificationSettingsInput, parseRootNotificationSettings);
  assert.equal(typeof parseCloudPreviewClientJson, "function");
  assert.equal(typeof parseRegisterPushSubscriptionInput, "function");
});
