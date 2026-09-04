import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOUD_RELAY_PROTOCOL_VERSION as rootCloudProtocolVersion,
  COMPACT_DIFF_PLACEHOLDER_TEXT as rootCompactDiffPlaceholderText,
  hasCompactDiffPlaceholderText as hasRootCompactDiffPlaceholderText,
  isCanonicalCompactDiffPlaceholderPart as isRootCanonicalCompactDiffPlaceholderPart,
  parseCreateSessionInput as parseRootCreateSessionInput,
  parseUpdateNotificationSettingsInput as parseRootNotificationSettings
} from "@deskcue/protocol";
import {
  CLOUD_RELAY_PROTOCOL_VERSION,
  CLOUD_RELAY_V1_CONTRACT_MANIFEST,
  parseCloudPreviewClientJson
} from "@deskcue/protocol/cloud";
import {
  COMPACT_DIFF_PLACEHOLDER_TEXT,
  hasCompactDiffPlaceholderText,
  isCanonicalCompactDiffPlaceholderPart
} from "@deskcue/protocol/transcript/compact-diff";
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
  assert.equal(COMPACT_DIFF_PLACEHOLDER_TEXT, rootCompactDiffPlaceholderText);
  assert.equal(hasCompactDiffPlaceholderText, hasRootCompactDiffPlaceholderText);
  assert.equal(isCanonicalCompactDiffPlaceholderPart, isRootCanonicalCompactDiffPlaceholderPart);
  const canonicalPlaceholder = {
    filePath: null,
    text: COMPACT_DIFF_PLACEHOLDER_TEXT,
    title: "Changes",
    type: "diff"
  };

  assert.equal(hasCompactDiffPlaceholderText(canonicalPlaceholder), true);
  assert.equal(isCanonicalCompactDiffPlaceholderPart(canonicalPlaceholder), true);
  assert.equal(hasCompactDiffPlaceholderText({
    ...canonicalPlaceholder,
    filePath: "src/app.ts",
    title: "src/app.ts"
  }), true);
  assert.equal(isCanonicalCompactDiffPlaceholderPart({
    ...canonicalPlaceholder,
    filePath: "src/app.ts",
    title: "src/app.ts"
  }), false);
  assert.equal(typeof parseCloudPreviewClientJson, "function");
  assert.equal(typeof parseRegisterPushSubscriptionInput, "function");
});
