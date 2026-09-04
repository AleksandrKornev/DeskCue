import assert from "node:assert/strict";
import test from "node:test";

import { resolveLocalAssetByteRange } from "./assetFileResponse.ts";

test("resolves bounded, open-ended and suffix asset byte ranges", () => {
  assert.deepEqual(resolveLocalAssetByteRange("bytes=10-19", 100n), {
    end: 19n,
    start: 10n
  });
  assert.deepEqual(resolveLocalAssetByteRange("bytes=90-", 100n), {
    end: 99n,
    start: 90n
  });
  assert.deepEqual(resolveLocalAssetByteRange("bytes=-10", 100n), {
    end: 99n,
    start: 90n
  });
  assert.deepEqual(resolveLocalAssetByteRange("bytes=90-200", 100n), {
    end: 99n,
    start: 90n
  });
});

test("rejects malformed and unsatisfiable asset byte ranges", () => {
  assert.equal(resolveLocalAssetByteRange("bytes=100-", 100n), "unsatisfiable");
  assert.equal(resolveLocalAssetByteRange("bytes=20-10", 100n), "unsatisfiable");
  assert.equal(resolveLocalAssetByteRange("bytes=0-1,4-5", 100n), "unsatisfiable");
  assert.equal(resolveLocalAssetByteRange("bytes=-0", 100n), "unsatisfiable");
  assert.equal(resolveLocalAssetByteRange("bytes=0-1", 0n), "unsatisfiable");
  assert.equal(resolveLocalAssetByteRange(undefined, 100n), null);
});
