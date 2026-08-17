import assert from "node:assert/strict";
import test from "node:test";

import { readBoundedCloudResponse } from "./cloudBoundedResponse.ts";

test("bounded Cloud response cancels a stream as soon as the byte limit is exceeded", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("1234"));
      controller.enqueue(Buffer.from("5678"));
      controller.enqueue(Buffer.from("9"));
    },
    cancel() {
      cancelled = true;
    }
  }));

  assert.equal(await readBoundedCloudResponse(response, 8), null);
  assert.equal(cancelled, true);
});

test("bounded Cloud response preserves an exact response at the byte limit", async () => {
  const response = new Response(Buffer.from("12345678"));
  assert.equal((await readBoundedCloudResponse(response, 8))?.toString("utf8"), "12345678");
});
