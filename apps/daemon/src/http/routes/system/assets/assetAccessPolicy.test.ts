import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AssetAccessPolicy } from "./assetAccessPolicy.ts";

test("asset policy rejects sibling path prefixes and validates image types after root access", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "deskcue-asset-policy-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const workspacePath = join(root, "project");
  const siblingPath = join(root, "project-other");
  const missingSiblingFile = join(root, "project-missing", "report.txt");
  await mkdir(join(workspacePath, "artifacts"), { recursive: true });
  await mkdir(siblingPath, { recursive: true });
  await writeFile(join(workspacePath, "artifacts", "report.txt"), "allowed");
  await writeFile(join(workspacePath, "note.txt"), "not an image");
  await writeFile(join(siblingPath, "report.txt"), "denied");
  const policy = new AssetAccessPolicy({
    listWorkspaces: () => [{ path: workspacePath }],
    trustedFileRoots: [],
    trustedImageRoots: []
  });

  const allowedFile = policy.normalizePath(join(workspacePath, "artifacts", "report.txt"));
  const siblingFile = policy.normalizePath(join(siblingPath, "report.txt"));
  const allowedTextAsImage = policy.normalizePath(join(workspacePath, "note.txt"));

  assert.ok(allowedFile);
  assert.ok(siblingFile);
  assert.ok(allowedTextAsImage);
  assert.deepEqual(await policy.authorizeFile(allowedFile), {
    error: null,
    path: await realpath(allowedFile)
  });
  assert.deepEqual(await policy.authorizeFile(siblingFile), {
    error: {
      statusCode: 403,
      message: "Local assets are only available from registered workspaces or trusted generated artifact roots."
    },
    path: null
  });
  assert.deepEqual(
    await policy.authorizeFile(missingSiblingFile),
    await policy.authorizeFile(siblingFile)
  );
  assert.deepEqual(await policy.authorizeImage(allowedTextAsImage), {
    error: {
      statusCode: 400,
      message: "Unsupported local image type."
    },
    path: null
  });
});

test("asset policy rejects a symlink or junction that escapes a workspace", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "deskcue-asset-symlink-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const workspacePath = join(root, "workspace");
  const outsidePath = join(root, "outside");
  await mkdir(workspacePath);
  await mkdir(outsidePath);
  await writeFile(join(outsidePath, "secret.txt"), "secret");
  const linkPath = join(workspacePath, "escape");
  try {
    await symlink(outsidePath, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32") {
      context.skip("This Windows account cannot create a junction/symlink.");
      return;
    }
    throw error;
  }

  const policy = new AssetAccessPolicy({
    listWorkspaces: () => [{ path: workspacePath }],
    trustedFileRoots: [],
    trustedImageRoots: []
  });
  const escapedFile = policy.normalizePath(join(linkPath, "secret.txt"));
  assert.ok(escapedFile);
  assert.deepEqual(await policy.authorizeFile(escapedFile), {
    error: {
      statusCode: 403,
      message: "Local assets are only available from registered workspaces or trusted generated artifact roots."
    },
    path: null
  });
});

test("asset ticket policy resolves transcript attachments through a managed session", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "deskcue-asset-attachment-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const attachmentPath = join(root, "report.pdf");
  await writeFile(attachmentPath, "report");
  const policy = new AssetAccessPolicy({
    listWorkspaces: () => [],
    managedSessions: {
      getSession: (sessionId: string) => sessionId === "managed-1"
        ? {
            adapterId: "codex",
            sourceSessionId: "source-1"
          }
        : null
    } as never,
    sourceAgentSessions: {
      getSessionDetail: async (sessionId: string) => sessionId === "codex:source-1"
        ? {
            transcript: [
              {
                parts: [
                  {
                    path: attachmentPath,
                    type: "attachment"
                  }
                ]
              }
            ]
          }
        : null
    } as never,
    trustedFileRoots: [],
    trustedImageRoots: []
  });

  assert.deepEqual(
    await policy.authorizeTicket("file", attachmentPath, {
      managedSessionId: "managed-1"
    }),
    { error: null, path: await realpath(attachmentPath) }
  );
  assert.deepEqual(
    await policy.authorizeTicket("file", attachmentPath, {
      managedSessionId: "missing"
    }),
    {
      error: {
        statusCode: 403,
        message: "Local assets are only available from registered workspaces, trusted generated artifact roots, or transcript attachments."
      },
      path: null
    }
  );
});
