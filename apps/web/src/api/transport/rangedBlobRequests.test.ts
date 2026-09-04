import type { AxiosRequestConfig, AxiosResponse } from "axios";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { api } from "./client";
import {
  getRangedBlob,
  RANGED_BLOB_CHUNK_BYTES
} from "./requests";

const originalGet = api.get;

function mockGet(
  implementation: (
    url: string,
    config?: AxiosRequestConfig
  ) => Promise<AxiosResponse<unknown>>
) {
  api.get = implementation as unknown as typeof api.get;
}

function response<TData>(
  data: TData,
  status: number,
  headers: Record<string, string> = {}
) {
  return {
    config: {},
    data,
    headers,
    status,
    statusText: String(status)
  } as AxiosResponse<TData>;
}

function readHeader(headers: unknown, name: string) {
  if (!headers || typeof headers !== "object") return null;

  const value = (headers as Record<string, unknown>)[name];

  return typeof value === "string" ? value : null;
}

afterEach(() => {
  api.get = originalGet;
});

test("assembles a bounded blob from contiguous asset ranges", async () => {
  const requestedRanges: string[] = [];
  const totalBytes = RANGED_BLOB_CHUNK_BYTES + 3;
  const firstChunk = new Uint8Array(RANGED_BLOB_CHUNK_BYTES);

  firstChunk[0] = 7;
  mockGet((_url, config) => {
    const range = readHeader(config?.headers, "Range");

    requestedRanges.push(range ?? "");
    if (requestedRanges.length === 1) {
      return Promise.resolve(response(
        new Blob([firstChunk], { type: "image/gif" }),
        206,
        {
          "content-range": `bytes 0-${RANGED_BLOB_CHUNK_BYTES - 1}/${totalBytes}`,
          "content-type": "image/gif"
        }
      ));
    }

    return Promise.resolve(response(
      new Blob([new Uint8Array([8, 9, 10])], { type: "image/gif" }),
      206,
      {
        "content-range": `bytes ${RANGED_BLOB_CHUNK_BYTES}-${totalBytes - 1}/${totalBytes}`,
        "content-type": "image/gif"
      }
    ));
  });

  const blob = await getRangedBlob("/api/assets/ticket/asset", "Asset failed", {
    maximumBytes: totalBytes
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());

  assert.deepEqual(requestedRanges, [
    `bytes=0-${RANGED_BLOB_CHUNK_BYTES - 1}`,
    `bytes=${RANGED_BLOB_CHUNK_BYTES}-${totalBytes - 1}`
  ]);
  assert.equal(blob.size, totalBytes);
  assert.equal(blob.type, "image/gif");
  assert.equal(bytes[0], 7);
  assert.deepEqual([...bytes.slice(-3)], [8, 9, 10]);
});

test("accepts the exact unsatisfied range response for an empty asset", async () => {
  mockGet((_url, config) => {
    assert.equal(readHeader(config?.headers, "Range"), `bytes=0-${RANGED_BLOB_CHUNK_BYTES - 1}`);
    assert.equal(config?.validateStatus?.(416), true);

    return Promise.resolve(response(
      new Blob([]),
      416,
      {
        "content-range": "bytes */0",
        "content-type": "text/plain"
      }
    ));
  });

  const blob = await getRangedBlob("/api/assets/ticket/empty", "Asset failed");

  assert.equal(blob.size, 0);
  assert.equal(blob.type, "text/plain");
});

test("rejects non-contiguous and oversized ranged blobs", async () => {
  mockGet(() => Promise.resolve(response(
    new Blob([new Uint8Array(4)], { type: "image/png" }),
    206,
    {
      "content-range": "bytes 1-4/5",
      "content-type": "image/png"
    }
  )));

  await assert.rejects(
    getRangedBlob("/api/assets/ticket/non-contiguous", "Asset failed", { maximumBytes: 8 })
  );

  mockGet(() => Promise.resolve(response(
    new Blob([new Uint8Array(8)], { type: "image/png" }),
    206,
    {
      "content-range": "bytes 0-7/9",
      "content-type": "image/png"
    }
  )));

  await assert.rejects(
    getRangedBlob("/api/assets/ticket/oversized", "Asset failed", { maximumBytes: 8 })
  );
});

test("rejects short intermediate ranges and changing content types", async () => {
  mockGet(() => Promise.resolve(response(
    new Blob([new Uint8Array(2)], { type: "image/png" }),
    206,
    {
      "content-range": "bytes 0-1/8",
      "content-type": "image/png"
    }
  )));

  await assert.rejects(
    getRangedBlob("/api/assets/ticket/short", "Asset failed", { maximumBytes: 8 })
  );

  let requestCount = 0;

  mockGet(() => {
    requestCount += 1;

    return Promise.resolve(requestCount === 1
      ? response(
          new Blob([new Uint8Array(RANGED_BLOB_CHUNK_BYTES)], { type: "image/png" }),
          206,
          {
            "content-range": `bytes 0-${RANGED_BLOB_CHUNK_BYTES - 1}/${RANGED_BLOB_CHUNK_BYTES + 1}`,
            "content-type": "image/png"
          }
        )
      : response(
          new Blob([new Uint8Array(1)], { type: "image/gif" }),
          206,
          {
            "content-range": `bytes ${RANGED_BLOB_CHUNK_BYTES}-${RANGED_BLOB_CHUNK_BYTES}/${RANGED_BLOB_CHUNK_BYTES + 1}`,
            "content-type": "image/gif"
          }
        ));
  });

  await assert.rejects(
    getRangedBlob("/api/assets/ticket/type-change", "Asset failed", {
      maximumBytes: RANGED_BLOB_CHUNK_BYTES + 1
    })
  );
});
