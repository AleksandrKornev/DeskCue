import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertAllowedUpdateUrl,
  downloadUpdateArtifact,
  readBoundedUpdateResponse,
  UpdateError
} from "../dist/index.js";

const RELEASE_HOST = "releases.example.test";

function artifact(bytes, overrides = {}) {
  return {
    platform: "win32",
    architecture: "x64",
    url: `https://${RELEASE_HOST}/DeskCueSetup.exe`,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...overrides
  };
}

function bytesResponse(bytes, headers = {}) {
  return new Response(bytes, {
    headers: {
      "content-length": String(bytes.byteLength),
      ...headers
    },
    status: 200
  });
}

test("downloads to .part, verifies SHA-256 and atomically stages the installer", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-update-download-"));
  const destinationPath = join(tempDir, "staged", "DeskCueSetup.exe");
  const bytes = new TextEncoder().encode("verified installer");

  try {
    const progress = [];
    const result = await downloadUpdateArtifact({
      allowedHosts: [RELEASE_HOST],
      artifact: artifact(bytes),
      destinationPath,
      fetch: async () => bytesResponse(bytes),
      onProgress: (value) => progress.push(value.receivedBytes),
      timeoutMs: 1_000
    });

    assert.equal(result.path, destinationPath);
    assert.deepEqual(await readFile(destinationPath), Buffer.from(bytes));
    assert.equal(existsSync(`${destinationPath}.part`), false);
    assert.deepEqual(progress, [bytes.byteLength]);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("rejects oversized declarations before requesting the artifact", async () => {
  const bytes = new TextEncoder().encode("too large");
  let fetched = false;

  await assert.rejects(
    downloadUpdateArtifact({
      allowedHosts: [RELEASE_HOST],
      artifact: artifact(bytes),
      destinationPath: join(tmpdir(), "must-not-exist.exe"),
      fetch: async () => {
        fetched = true;
        return bytesResponse(bytes);
      },
      maxBytes: bytes.byteLength - 1,
      timeoutMs: 1_000
    }),
    (error) => error instanceof UpdateError && error.code === "artifact_size_mismatch"
  );
  assert.equal(fetched, false);
});

test("removes partial files after truncated and hash-mismatched downloads", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-update-download-"));
  const truncatedPath = join(tempDir, "truncated.exe");
  const hashPath = join(tempDir, "hash.exe");
  const expected = new TextEncoder().encode("expected installer");
  const truncated = expected.subarray(0, 5);

  try {
    await assert.rejects(
      downloadUpdateArtifact({
        allowedHosts: [RELEASE_HOST],
        artifact: artifact(expected),
        destinationPath: truncatedPath,
        fetch: async () => new Response(truncated, { status: 200 }),
        timeoutMs: 1_000
      }),
      (error) => error instanceof UpdateError && error.code === "artifact_size_mismatch"
    );
    assert.equal(existsSync(truncatedPath), false);
    assert.equal(existsSync(`${truncatedPath}.part`), false);

    await assert.rejects(
      downloadUpdateArtifact({
        allowedHosts: [RELEASE_HOST],
        artifact: artifact(expected, { sha256: "0".repeat(64) }),
        destinationPath: hashPath,
        fetch: async () => bytesResponse(expected),
        timeoutMs: 1_000
      }),
      (error) => error instanceof UpdateError && error.code === "artifact_hash_mismatch"
    );
    assert.equal(existsSync(hashPath), false);
    assert.equal(existsSync(`${hashPath}.part`), false);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("cancels the response when the staging file cannot be created", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-update-open-failure-"));
  const destinationPath = join(tempDir, "DeskCueSetup.exe");
  const partialPath = `${destinationPath}.part`;
  const bytes = new Uint8Array([1]);
  const competingBytes = new TextEncoder().encode("owned by another downloader");
  let cancellationCount = 0;

  try {
    await assert.rejects(downloadUpdateArtifact({
      allowedHosts: [RELEASE_HOST],
      artifact: artifact(bytes),
      destinationPath,
      fetch: async () => {
        await writeFile(partialPath, competingBytes, { flag: "wx" });

        return new Response(new ReadableStream({
          cancel() {
            cancellationCount += 1;
          }
        }), {
          headers: { "content-length": String(bytes.byteLength) },
          status: 200
        });
      },
      timeoutMs: 1_000
    }));

    assert.equal(cancellationCount, 1);
    assert.deepEqual(await readFile(partialPath), Buffer.from(competingBytes));
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("cancels an oversized artifact response once and removes its owned staging file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-update-oversized-stream-"));
  const destinationPath = join(tempDir, "DeskCueSetup.exe");
  const expected = new Uint8Array([1]);
  let cancellationCount = 0;

  try {
    await assert.rejects(
      downloadUpdateArtifact({
        allowedHosts: [RELEASE_HOST],
        artifact: artifact(expected),
        destinationPath,
        fetch: async () => new Response(new ReadableStream({
          cancel() {
            cancellationCount += 1;
          },
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
          }
        }), { status: 200 }),
        timeoutMs: 1_000
      }),
      (error) => error instanceof UpdateError && error.code === "artifact_size_mismatch"
    );

    assert.equal(cancellationCount, 1);
    assert.equal(existsSync(destinationPath), false);
    assert.equal(existsSync(`${destinationPath}.part`), false);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("rejects HTTP, credentials and redirects to a different host", async () => {
  assert.throws(
    () => assertAllowedUpdateUrl(`http://${RELEASE_HOST}/manifest.json`, [RELEASE_HOST]),
    /must use HTTPS/
  );
  assert.throws(
    () => assertAllowedUpdateUrl(`https://user:secret@${RELEASE_HOST}/manifest.json`, [RELEASE_HOST]),
    /cannot contain credentials/
  );

  await assert.rejects(
    readBoundedUpdateResponse(`https://${RELEASE_HOST}/manifest.json`, {
      allowedHosts: [RELEASE_HOST],
      fetch: async () => new Response(null, {
        headers: { location: "https://evil.example.test/manifest.json" },
        status: 302
      }),
      maxBytes: 1_024,
      timeoutMs: 1_000
    }),
    (error) => error instanceof UpdateError && error.code === "invalid_update_source"
  );
});

test("bounds manifest responses even when Content-Length is absent", async () => {
  const bytes = new Uint8Array(20);

  await assert.rejects(
    readBoundedUpdateResponse(`https://${RELEASE_HOST}/manifest.json`, {
      allowedHosts: [RELEASE_HOST],
      fetch: async () => new Response(bytes, { status: 200 }),
      maxBytes: 10,
      timeoutMs: 1_000
    }),
    (error) => error instanceof UpdateError && error.code === "artifact_size_mismatch"
  );
});

test("aborts an update request when its deadline expires", async () => {
  await assert.rejects(
    readBoundedUpdateResponse(`https://${RELEASE_HOST}/manifest.json`, {
      allowedHosts: [RELEASE_HOST],
      fetch: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
      maxBytes: 1_024,
      timeoutMs: 10
    }),
    (error) => error instanceof UpdateError && error.code === "timeout"
  );
});

test("uses stream inactivity instead of the response-header timeout for large downloads", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-update-inactivity-"));
  const destinationPath = join(tempDir, "DeskCueSetup.exe");
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);

  try {
    const result = await downloadUpdateArtifact({
      allowedHosts: [RELEASE_HOST],
      artifact: artifact(bytes),
      destinationPath,
      fetch: async () => new Response(new ReadableStream({
        async start(controller) {
          for (const byte of bytes) {
            await new Promise((resolve) => setTimeout(resolve, 2));
            controller.enqueue(Uint8Array.of(byte));
          }
          controller.close();
        }
      }), { status: 200 }),
      inactivityTimeoutMs: 20,
      timeoutMs: 5
    });

    assert.equal(result.receivedBytes, bytes.byteLength);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("aborts a stalled artifact stream after the inactivity timeout", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-update-inactivity-"));
  const destinationPath = join(tempDir, "DeskCueSetup.exe");
  const bytes = new Uint8Array([1]);

  try {
    await assert.rejects(
      downloadUpdateArtifact({
        allowedHosts: [RELEASE_HOST],
        artifact: artifact(bytes),
        destinationPath,
        fetch: async (_url, init) => new Response(new ReadableStream({
          start(controller) {
            init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
          }
        }), { status: 200 }),
        inactivityTimeoutMs: 10,
        timeoutMs: 1_000
      }),
      (error) => error instanceof UpdateError && error.code === "timeout"
    );
    assert.equal(existsSync(`${destinationPath}.part`), false);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
