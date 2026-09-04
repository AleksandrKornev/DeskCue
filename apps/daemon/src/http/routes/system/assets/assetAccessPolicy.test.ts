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

import {
  normalizeMarkdownLocalAssetPath,
  normalizeWindowsMarkdownTargets
} from "@deskcue/protocol/markdown";

import {
  AssetAccessPolicy,
  normalizeAssetPolicyComparablePath
} from "./assetAccessPolicy.ts";

test("asset policy preserves POSIX case and folds Windows case", () => {
  assert.notEqual(
    normalizeAssetPolicyComparablePath("/uploads/Report.pdf", "linux"),
    normalizeAssetPolicyComparablePath("/uploads/report.pdf", "linux")
  );

  assert.equal(
    normalizeAssetPolicyComparablePath("C:\\Uploads\\Report.pdf", "win32"),
    normalizeAssetPolicyComparablePath("C:\\Uploads\\report.pdf", "win32")
  );
});

test("asset policy normalizes the local Markdown forms rendered by the web client", () => {
  assert.equal(
    normalizeMarkdownLocalAssetPath("file:///D:/work/My%20Report.txt"),
    "D:/work/My Report.txt"
  );

  assert.equal(
    normalizeMarkdownLocalAssetPath("/D:/work/DeskCue/App.tsx:49:7"),
    "D:/work/DeskCue/App.tsx"
  );

  assert.equal(
    normalizeMarkdownLocalAssetPath("D:/work/DeskCue/header.png?v=2#preview"),
    "D:/work/DeskCue/header.png"
  );

  assert.equal(normalizeMarkdownLocalAssetPath("https://example.com/report.txt"), null);
});

test("asset policy recovers raw Windows Markdown targets without rewriting code", () => {
  const rawLink = String.raw`[clip](D:\Videos\DeskCue - Google Chrome.mp4)`;

  assert.equal(
    normalizeWindowsMarkdownTargets(rawLink),
    "[clip](</D:/Videos/DeskCue - Google Chrome.mp4>)"
  );

  assert.equal(normalizeWindowsMarkdownTargets(`\`${rawLink}\``), `\`${rawLink}\``);
  assert.equal(
    normalizeWindowsMarkdownTargets(`\`\`\`text\n${rawLink}\n\`\`\``),
    `\`\`\`text\n${rawLink}\n\`\`\``
  );

  assert.equal(normalizeWindowsMarkdownTargets(`    ${rawLink}`), `    ${rawLink}`);
});

test("asset policy rejects sibling path prefixes and validates image types after root access", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "deskcue-asset-policy-"));

  context.after(() => rm(root, { force: true, recursive: true }));
  const workspacePath = join(root, "project");
  const siblingPath = join(root, "project-other");
  const missingSiblingFile = join(root, "project-missing", "report.txt");

  await mkdir(join(workspacePath, "artifacts"), { recursive: true });

  await mkdir(siblingPath, { recursive: true });
  await writeFile(join(workspacePath, "artifacts", "capture.avif"), "avif");
  await writeFile(join(workspacePath, "artifacts", "report.txt"), "allowed");
  await writeFile(join(workspacePath, "note.txt"), "not an image");
  await writeFile(join(siblingPath, "report.txt"), "denied");
  const policy = new AssetAccessPolicy({
    listWorkspaces: () => [{ path: workspacePath }],
    trustedFileRoots: [],
    trustedImageRoots: []
  });

  const allowedFile = policy.normalizePath(join(workspacePath, "artifacts", "report.txt"));
  const allowedAvif = policy.normalizePath(join(workspacePath, "artifacts", "capture.avif"));
  const siblingFile = policy.normalizePath(join(siblingPath, "report.txt"));
  const allowedTextAsImage = policy.normalizePath(join(workspacePath, "note.txt"));

  assert.ok(allowedFile);
  assert.ok(allowedAvif);
  assert.ok(siblingFile);
  assert.ok(allowedTextAsImage);
  assert.deepEqual(await policy.authorizeFile(allowedFile), {
    error: null,
    path: await realpath(allowedFile)
  });
  assert.deepEqual(await policy.authorizeImage(allowedAvif), {
    error: null,
    path: await realpath(allowedAvif)
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
  const markdownImagePath = join(root, "screenshot.png");
  const rawMarkdownImagePath = join(root, "raw screenshot.png");
  const encodedMarkdownFilePath = join(root, "encoded report.txt");
  const ambiguousMarkdownImagePath = join(root, "ambiguous (final).png");
  const siblingPath = join(root, "secrets.txt");

  await writeFile(attachmentPath, "report");
  await writeFile(markdownImagePath, "image");
  await writeFile(rawMarkdownImagePath, "raw image");
  await writeFile(encodedMarkdownFilePath, "encoded report");
  await writeFile(ambiguousMarkdownImagePath, "ambiguous image");
  await writeFile(siblingPath, "secret");
  const markdownImageUrl = process.platform === "win32"
    ? `file:///${markdownImagePath.replaceAll("\\", "/")}`
    : `file://${markdownImagePath}`;
  const policy = new AssetAccessPolicy({
    listWorkspaces: () => [{ id: "workspace-1", path: root }],
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
              },
              {
                parts: [
                  {
                    type: "markdown",
                    text: `![Screenshot](${markdownImageUrl}?v=2#preview)\n\n\`\`\`text\n${siblingPath}\n\`\`\``
                  }
                ]
              },
              {
                parts: [{
                  type: "markdown",
                  text: `[Encoded report](<${encodedMarkdownFilePath.replaceAll("\\", "/").replaceAll(" ", "%20")}>)`
                }]
              },
              {
                parts: [{
                  type: "markdown",
                  text: process.platform === "win32"
                    ? `![Raw screenshot](${rawMarkdownImagePath})`
                    : `![Raw screenshot](<${rawMarkdownImagePath}>)`
                }]
              },
              {
                parts: [{
                  type: "markdown",
                  text: process.platform === "win32"
                    ? `![Ambiguous screenshot](${ambiguousMarkdownImagePath})`
                    : ""
                }]
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
      managedSessionId: "managed-1",
      workspaceId: "workspace-1"
    }),
    { error: null, path: await realpath(attachmentPath) }
  );

  assert.deepEqual(
    await policy.authorizeTicket("local_image", markdownImagePath, {
      managedSessionId: "managed-1",
      workspaceId: "workspace-1"
    }),
    { error: null, path: await realpath(markdownImagePath) }
  );

  assert.deepEqual(
    await policy.authorizeTicket("local_image", rawMarkdownImagePath, {
      managedSessionId: "managed-1"
    }),
    { error: null, path: await realpath(rawMarkdownImagePath) }
  );

  assert.deepEqual(
    await policy.authorizeTicket("file", encodedMarkdownFilePath, {
      managedSessionId: "managed-1"
    }),
    { error: null, path: await realpath(encodedMarkdownFilePath) }
  );

  if (process.platform === "win32") {
    assert.deepEqual(
      await policy.authorizeTicket("local_image", ambiguousMarkdownImagePath, {
        managedSessionId: "managed-1"
      }),
      {
        error: {
          statusCode: 403,
          message: "Local images are only available from registered workspaces, trusted temporary directories, or transcript attachments."
        },
        path: null
      }
    );
  }

  assert.deepEqual(
    await policy.authorizeTicket("file", siblingPath, {
      managedSessionId: "managed-1",
      workspaceId: "workspace-1"
    }),
    {
      error: {
        statusCode: 403,
        message: "Local assets are only available from registered workspaces, trusted generated artifact roots, or transcript attachments."
      },
      path: null
    }
  );

  assert.deepEqual(
    await policy.authorizeTicket("file", siblingPath, {
      workspaceId: "workspace-1"
    }),
    { error: null, path: await realpath(siblingPath) }
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
