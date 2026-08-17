import assert from "node:assert/strict";
import test from "node:test";

import { ByteBoundedCache } from "./codexTranscriptCache.ts";

test("evicts the least recently used transcript cache entry", () => {
  const cache = new ByteBoundedCache<string, { text: string }>({
    clone: structuredClone,
    maxBytes: 100,
    maxEntries: 2,
    maxItemBytes: 100,
    measure: (value) => value.text.length
  });

  cache.set("first", { text: "one" });
  cache.set("second", { text: "two" });
  assert.deepEqual(cache.get("first"), { text: "one" });

  cache.set("third", { text: "three" });

  assert.equal(cache.get("second"), null);
  assert.deepEqual(cache.get("first"), { text: "one" });
  assert.deepEqual(cache.get("third"), { text: "three" });
});

test("does not retain oversized transcript cache entries and clones values", () => {
  const cache = new ByteBoundedCache<string, { nested: { text: string } }>({
    clone: structuredClone,
    maxBytes: 8,
    maxEntries: 4,
    maxItemBytes: 5,
    measure: (value) => value.nested.text.length
  });
  const source = { nested: { text: "small" } };

  assert.equal(cache.set("small", source), true);
  source.nested.text = "changed externally";
  const cached = cache.get("small");
  assert.equal(cached?.nested.text, "small");
  if (cached) {
    cached.nested.text = "changed after read";
  }
  assert.equal(cache.get("small")?.nested.text, "small");

  assert.equal(cache.set("large", { nested: { text: "too large" } }), false);
  assert.equal(cache.get("large"), null);
});
