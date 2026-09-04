import express from "express";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installAssetRoutes } from "./assetRoutes.ts";

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function withServer(app: express.Express, callback: (baseUrl: string) => Promise<void>) {
  const server = createServer(app);

  return new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address();

        assert(address && typeof address === "object");

        await callback(`http://127.0.0.1:${address.port}`);
        closeServer(server).then(resolve, reject);
      } catch (error) {
        closeServer(server).then(() => reject(error), reject);
      }
    });
  });
}

test("local asset routes only serve files inside registered workspaces", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-"));
  const workspacePath = join(tempDir, "workspace");
  const allowedFile = join(workspacePath, "asset.txt");
  const deniedFile = join(tempDir, "outside.txt");

  try {
    await mkdir(workspacePath, {
      recursive: true
    });

    await writeFile(allowedFile, "inside", "utf8");
    await writeFile(deniedFile, "outside", "utf8");

    const app = express();

    installAssetRoutes(app, {
      workspaces: {
        listWorkspaces: () => [
          {
            path: workspacePath
          }
        ]
      }
    });

    await withServer(app, async (baseUrl) => {
      const allowed = await fetch(
        `${baseUrl}/api/assets/file?path=${encodeURIComponent(allowedFile)}`
      );
      const denied = await fetch(
        `${baseUrl}/api/assets/file?path=${encodeURIComponent(deniedFile)}`
      );

      assert.equal(allowed.status, 200);
      assert.equal(await allowed.text(), "inside");
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), {
        error: "Local assets are only available from registered workspaces or trusted generated artifact roots."
      });
    });
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("asset tickets resolve relative paths inside their registered workspace", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-workspace-assets-"));
  const workspacePath = join(tempDir, "workspace");
  const allowedFile = join(workspacePath, "artifact.txt");

  try {
    await mkdir(workspacePath, { recursive: true });
    await writeFile(allowedFile, "workspace artifact", "utf8");
    const app = express();

    app.use(express.json());

    installAssetRoutes(app, {
      workspaces: {
        listWorkspaces: () => [{ id: "workspace-1", path: workspacePath }]
      }
    });

    await withServer(app, async (baseUrl) => {
      const ticketResponse = await fetch(`${baseUrl}/api/assets/ticket`, {
        body: JSON.stringify({
          download: true,
          kind: "file",
          maxBytes: 64,
          path: "artifact.txt",
          workspaceId: "workspace-1"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const ticketPayload = await ticketResponse.json() as { url: string };
      const assetResponse = await fetch(`${baseUrl}${ticketPayload.url}`);
      const escapedResponse = await fetch(`${baseUrl}/api/assets/ticket`, {
        body: JSON.stringify({
          kind: "file",
          path: "../outside.txt",
          workspaceId: "workspace-1"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });

      assert.equal(ticketResponse.status, 201);
      assert.equal(assetResponse.status, 200);
      assert.equal(await assetResponse.text(), "workspace artifact");
      assert.match(assetResponse.headers.get("content-disposition") ?? "", /^attachment;/i);
      assert.equal(escapedResponse.status, 403);
      assert.deepEqual(await escapedResponse.json(), {
        error: "Workspace asset path escapes its registered workspace."
      });
    });
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("bounded asset tickets reject a file that grows after ticket creation", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-bounded-assets-"));
  const workspacePath = join(tempDir, "workspace");
  const imagePath = join(workspacePath, "image.png");

  try {
    await mkdir(workspacePath, { recursive: true });
    await writeFile(imagePath, "small", "utf8");
    const app = express();

    app.use(express.json());

    installAssetRoutes(app, {
      workspaces: {
        listWorkspaces: () => [{ id: "workspace-1", path: workspacePath }]
      }
    });

    await withServer(app, async (baseUrl) => {
      const ticketResponse = await fetch(`${baseUrl}/api/assets/ticket`, {
        body: JSON.stringify({
          kind: "local_image",
          maxBytes: 8,
          path: "image.png",
          workspaceId: "workspace-1"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const ticket = await ticketResponse.json() as { url: string };

      await writeFile(imagePath, "now too large", "utf8");

      const assetResponse = await fetch(`${baseUrl}${ticket.url}`);

      assert.equal(ticketResponse.status, 201);
      assert.equal(assetResponse.status, 413);
      assert.deepEqual(await assetResponse.json(), {
        error: "Local asset exceeds this preview ticket's byte limit."
      });
    });
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("asset tickets reject same-path file replacement after authorization", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-replaced-assets-"));
  const workspacePath = join(tempDir, "workspace");
  const imagePath = join(workspacePath, "image.png");

  try {
    await mkdir(workspacePath, { recursive: true });
    await writeFile(imagePath, "original", "utf8");
    const app = express();

    app.use(express.json());

    installAssetRoutes(app, {
      workspaces: {
        listWorkspaces: () => [{ id: "workspace-1", path: workspacePath }]
      }
    });

    await withServer(app, async (baseUrl) => {
      const ticketResponse = await fetch(`${baseUrl}/api/assets/ticket`, {
        body: JSON.stringify({
          kind: "local_image",
          maxBytes: 64,
          path: "image.png",
          workspaceId: "workspace-1"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const ticket = await ticketResponse.json() as { url: string };

      await rename(imagePath, join(workspacePath, "original.png"));
      await writeFile(imagePath, "replacement", "utf8");

      const assetResponse = await fetch(`${baseUrl}${ticket.url}`);

      assert.equal(ticketResponse.status, 201);
      assert.equal(assetResponse.status, 403);
      assert.deepEqual(await assetResponse.json(), {
        error: "The local asset changed after this link was created. Open it again from DeskCue."
      });
    });
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("workspace asset tickets reject symlinks into another registered workspace", async (context) => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-workspace-asset-scope-"));

  context.after(() => rm(tempDir, { force: true, recursive: true }));
  const workspaceAPath = join(tempDir, "workspace-a");
  const workspaceBPath = join(tempDir, "workspace-b");
  const workspaceBLink = join(workspaceAPath, "workspace-b-link");

  await mkdir(workspaceAPath);
  await mkdir(workspaceBPath);
  await writeFile(join(workspaceBPath, "secret.txt"), "workspace b secret", "utf8");

  try {
    await symlink(workspaceBPath, workspaceBLink, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32") {
      context.skip("This Windows account cannot create a junction/symlink.");
      return;
    }

    throw error;
  }

  const app = express();

  app.use(express.json());

  installAssetRoutes(app, {
    workspaces: {
      listWorkspaces: () => [
        { id: "workspace-a", path: workspaceAPath },
        { id: "workspace-b", path: workspaceBPath }
      ]
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/assets/ticket`, {
      body: JSON.stringify({
        kind: "file",
        path: "workspace-b-link/secret.txt",
        workspaceId: "workspace-a"
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Workspace asset path escapes its registered workspace."
    });
  });
});

test("workspace asset tickets support a registered workspace junction", async (context) => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-workspace-asset-junction-"));

  context.after(() => rm(tempDir, { force: true, recursive: true }));
  const workspacePath = join(tempDir, "workspace");
  const workspaceAlias = join(tempDir, "workspace-alias");

  await mkdir(workspacePath);
  await writeFile(join(workspacePath, "artifact.txt"), "junction artifact", "utf8");

  try {
    await symlink(workspacePath, workspaceAlias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32") {
      context.skip("This Windows account cannot create a junction/symlink.");
      return;
    }

    throw error;
  }

  const app = express();

  app.use(express.json());

  installAssetRoutes(app, {
    workspaces: {
      listWorkspaces: () => [{ id: "workspace-1", path: workspaceAlias }]
    }
  });

  await withServer(app, async (baseUrl) => {
    const ticketResponse = await fetch(`${baseUrl}/api/assets/ticket`, {
      body: JSON.stringify({
        kind: "file",
        path: "artifact.txt",
        workspaceId: "workspace-1"
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const ticket = await ticketResponse.json() as { url: string };
    const assetResponse = await fetch(`${baseUrl}${ticket.url}`);

    assert.equal(ticketResponse.status, 201);
    assert.equal(assetResponse.status, 200);
    assert.equal(await assetResponse.text(), "junction artifact");
  });
});

test("local asset routes serve authorized files below hidden directories", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-hidden-"));
  const workspacePath = join(tempDir, "workspace");
  const hiddenDirectory = join(workspacePath, ".deskcue-artifacts");
  const imagePath = join(hiddenDirectory, "preview.png");

  try {
    await mkdir(hiddenDirectory, { recursive: true });
    await writeFile(imagePath, "image", "utf8");

    const app = express();

    app.use(express.json());

    installAssetRoutes(app, {
      workspaces: {
        listWorkspaces: () => [{ path: workspacePath }]
      }
    });

    await withServer(app, async (baseUrl) => {
      const directResponse = await fetch(
        `${baseUrl}/api/assets/local-image?path=${encodeURIComponent(imagePath)}`
      );
      const downloadResponse = await fetch(
        `${baseUrl}/api/assets/file?path=${encodeURIComponent(imagePath)}&download=1`
      );
      const ticketResponse = await fetch(`${baseUrl}/api/assets/ticket`, {
        body: JSON.stringify({
          kind: "local_image",
          path: imagePath
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const ticketPayload = await ticketResponse.json() as { url: string };
      const ticketAssetResponse = await fetch(`${baseUrl}${ticketPayload.url}`);

      assert.equal(directResponse.status, 200);
      assert.equal(directResponse.headers.get("cache-control"), "private, no-store");
      assert.equal(directResponse.headers.get("referrer-policy"), "no-referrer");
      assert.equal(await directResponse.text(), "image");
      assert.equal(downloadResponse.status, 200);
      assert.equal(downloadResponse.headers.get("cache-control"), "private, no-store");
      assert.equal(downloadResponse.headers.get("referrer-policy"), "no-referrer");
      assert.match(downloadResponse.headers.get("content-disposition") ?? "", /^attachment;/i);
      assert.equal(await downloadResponse.text(), "image");
      assert.equal(ticketResponse.status, 201);
      assert.equal(ticketAssetResponse.status, 200);
      assert.equal(ticketAssetResponse.headers.get("cache-control"), "private, no-store");
      assert.equal(ticketAssetResponse.headers.get("referrer-policy"), "no-referrer");
      assert.equal(await ticketAssetResponse.text(), "image");
    });
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("local asset routes reject symlink escapes and force SVG downloads", async (context) => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-security-"));

  context.after(() => rm(tempDir, { force: true, recursive: true }));
  const workspacePath = join(tempDir, "workspace");
  const outsidePath = join(tempDir, "outside");
  const svgPath = join(workspacePath, "generated.svg");

  await mkdir(workspacePath);

  await mkdir(outsidePath);
  await writeFile(join(outsidePath, "secret.txt"), "secret");
  await writeFile(svgPath, `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
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

  const app = express();

  installAssetRoutes(app, {
    workspaces: { listWorkspaces: () => [{ path: workspacePath }] }
  });

  await withServer(app, async (baseUrl) => {
    const escaped = await fetch(
      `${baseUrl}/api/assets/file?path=${encodeURIComponent(join(linkPath, "secret.txt"))}`
    );
    const svg = await fetch(
      `${baseUrl}/api/assets/local-image?path=${encodeURIComponent(svgPath)}`
    );

    assert.equal(escaped.status, 403);
    assert.equal(svg.status, 200);
    assert.match(svg.headers.get("content-disposition") ?? "", /^attachment;/i);
    assert.equal(svg.headers.get("x-content-type-options"), "nosniff");
  });
});

test("local asset routes force active documents to download", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-active-document-"));
  const workspacePath = join(tempDir, "workspace");
  const atomPath = join(workspacePath, "feed.atom");
  const htmlPath = join(workspacePath, "report.html");
  const svgzPath = join(workspacePath, "report.svgz");
  const xhtmlPath = join(workspacePath, "report.xhtml");

  try {
    await mkdir(workspacePath, { recursive: true });
    await writeFile(atomPath, "<feed xmlns=\"http://www.w3.org/2005/Atom\" />", "utf8");
    await writeFile(htmlPath, "<script>globalThis.compromised = true</script>", "utf8");
    await writeFile(svgzPath, "<svg><script>globalThis.compromised = true</script></svg>", "utf8");
    await writeFile(xhtmlPath, "<html xmlns=\"http://www.w3.org/1999/xhtml\" />", "utf8");
    const app = express();

    installAssetRoutes(app, {
      workspaces: {
        listWorkspaces: () => [{ id: "workspace-1", path: workspacePath }]
      }
    });

    await withServer(app, async (baseUrl) => {
      for (const assetPath of [atomPath, htmlPath, svgzPath, xhtmlPath]) {
        const response = await fetch(
          `${baseUrl}/api/assets/file?path=${encodeURIComponent(assetPath)}`
        );

        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/i);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      }
    });
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("local asset routes serve files from trusted generated artifact roots", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-"));
  const workspacePath = join(tempDir, "workspace");
  const trustedDownloads = join(tempDir, "Downloads");
  const trustedFile = join(trustedDownloads, "upload.pdf");
  const deniedFile = join(tempDir, "outside.pdf");

  try {
    await mkdir(workspacePath, {
      recursive: true
    });
    await mkdir(trustedDownloads, {
      recursive: true
    });

    await writeFile(trustedFile, "pdf", "utf8");
    await writeFile(deniedFile, "outside", "utf8");

    const app = express();

    installAssetRoutes(app, {
      trustedFileRoots: [trustedDownloads],
      workspaces: {
        listWorkspaces: () => [
          {
            path: workspacePath
          }
        ]
      }
    });

    await withServer(app, async (baseUrl) => {
      const allowed = await fetch(
        `${baseUrl}/api/assets/file?path=${encodeURIComponent(trustedFile)}`
      );
      const denied = await fetch(
        `${baseUrl}/api/assets/file?path=${encodeURIComponent(deniedFile)}`
      );

      assert.equal(allowed.status, 200);
      assert.equal(await allowed.text(), "pdf");
      assert.equal(denied.status, 403);
    });
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("asset ticket serves files from scoped transcript attachments", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-"));
  const workspacePath = join(tempDir, "workspace");
  const attachmentPath = join(tempDir, "uploads", "Screenshot test.pdf");

  try {
    await mkdir(workspacePath, {
      recursive: true
    });
    await mkdir(join(tempDir, "uploads"), {
      recursive: true
    });

    await writeFile(attachmentPath, "pdf", "utf8");

    const app = express();

    app.use(express.json());

    installAssetRoutes(app, {
      sourceAgentSessions: {
        getSessionDetail: async (agentSessionId: string) =>
          agentSessionId === "codex:source-1"
            ? {
                id: "codex:source-1",
                agentId: "codex",
                agentLabel: "Codex",
                sourceSessionId: "source-1",
                title: "Attachment session",
                workspacePath,
                workspaceName: "workspace",
                updatedAt: new Date().toISOString(),
                attachMode: "resume",
                attachModeReason: null,
                transcript: [
                  {
                    id: "entry-1",
                    role: "user",
                    timestamp: new Date().toISOString(),
                    text: "See attached PDF",
                    parts: [
                      {
                        type: "attachment",
                        kind: "local-file",
                        label: "Attachment 1",
                        path: attachmentPath,
                        url: null
                      }
                    ]
                  }
                ]
              }
            : null
      } as never,
      trustedFileRoots: [],
      workspaces: {
        listWorkspaces: () => [
          {
            id: "workspace-1",
            path: workspacePath
          }
        ]
      }
    });

    await withServer(app, async (baseUrl) => {
      const deniedTicket = await fetch(`${baseUrl}/api/assets/ticket`, {
        body: JSON.stringify({
          kind: "file",
          path: attachmentPath
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const allowedTicket = await fetch(`${baseUrl}/api/assets/ticket`, {
        body: JSON.stringify({
          agentSessionId: "codex:source-1",
          download: true,
          kind: "file",
          path: attachmentPath,
          workspaceId: "workspace-1"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const ticketPayload = await allowedTicket.json() as {
        url: string;
      };

      const assetResponse = await fetch(`${baseUrl}${ticketPayload.url}`);
      const scopedLinkQuery = new URLSearchParams({
        agentSessionId: "codex:source-1",
        path: attachmentPath,
        workspaceId: "workspace-1"
      });
      const scopedLinkResponse = await fetch(`${baseUrl}/api/assets/file?${scopedLinkQuery}`, {
        headers: {
          range: "bytes=0-1"
        }
      });

      assert.equal(deniedTicket.status, 403);
      assert.deepEqual(await deniedTicket.json(), {
        error: "Local assets are only available from registered workspaces, trusted generated artifact roots, or transcript attachments."
      });

      assert.equal(allowedTicket.status, 201);
      assert.equal(assetResponse.status, 200);
      assert.equal(await assetResponse.text(), "pdf");
      assert.equal(scopedLinkResponse.status, 206);
      assert.equal(await scopedLinkResponse.text(), "pd");
      assert.equal(scopedLinkResponse.headers.get("content-range"), "bytes 0-1/3");
      assert.match(
        assetResponse.headers.get("content-disposition") ?? "",
        /filename="Screenshot test\.pdf"/
      );
    });
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("transcript attachment ticket survives canonical reauthorization through a symlink", async (context) => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-ticket-symlink-"));

  context.after(() => rm(tempDir, { force: true, recursive: true }));
  const attachmentDirectory = join(tempDir, "attachments");
  const attachmentAlias = join(tempDir, "attachment-alias");

  await mkdir(attachmentDirectory);

  await writeFile(join(attachmentDirectory, "report.pdf"), "symlink report", "utf8");

  try {
    await symlink(
      attachmentDirectory,
      attachmentAlias,
      process.platform === "win32" ? "junction" : "dir"
    );
  } catch (error) {
    if (process.platform === "win32") {
      context.skip("This Windows account cannot create a junction/symlink.");
      return;
    }

    throw error;
  }

  const requestedPath = join(attachmentAlias, "report.pdf");

  const app = express();

  app.use(express.json());

  installAssetRoutes(app, {
    sourceAgentSessions: {
      getSessionDetail: async () => ({
        transcript: [{
          parts: [{ path: requestedPath, type: "attachment" }]
        }]
      })
    } as never,
    trustedFileRoots: [],
    trustedImageRoots: [],
    workspaces: { listWorkspaces: () => [] }
  });

  await withServer(app, async (baseUrl) => {
    const ticketResponse = await fetch(`${baseUrl}/api/assets/ticket`, {
      body: JSON.stringify({
        agentSessionId: "codex:source-1",
        kind: "file",
        path: requestedPath
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });

    assert.equal(ticketResponse.status, 201);
    const ticket = await ticketResponse.json() as { url: string };

    const assetResponse = await fetch(`${baseUrl}${ticket.url}`);

    assert.equal(assetResponse.status, 200);

    assert.equal(await assetResponse.text(), "symlink report");
  });
});

test("local image route serves images from the system temp directory", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-"));
  const workspacePath = join(tempDir, "workspace");
  const tempImage = join(tempDir, "screenshot.png");
  const tempText = join(tempDir, "note.txt");

  try {
    await mkdir(workspacePath, {
      recursive: true
    });

    await writeFile(tempImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(tempText, "not an image", "utf8");

    const app = express();

    installAssetRoutes(app, {
      workspaces: {
        listWorkspaces: () => [
          {
            path: workspacePath
          }
        ]
      }
    });

    await withServer(app, async (baseUrl) => {
      const allowedImage = await fetch(
        `${baseUrl}/api/assets/local-image?path=${encodeURIComponent(tempImage)}`
      );
      const deniedText = await fetch(
        `${baseUrl}/api/assets/local-image?path=${encodeURIComponent(tempText)}`
      );
      const deniedFileRoute = await fetch(
        `${baseUrl}/api/assets/file?path=${encodeURIComponent(tempImage)}`
      );

      assert.equal(allowedImage.status, 200);
      assert.equal(deniedText.status, 400);
      assert.deepEqual(await deniedText.json(), {
        error: "Unsupported local image type."
      });

      assert.equal(deniedFileRoute.status, 403);
    });
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("local image route serves images from trusted agent asset roots", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-"));
  const workspacePath = join(tempDir, "workspace");
  const trustedAgentRoot = join(tempDir, "agent-home");
  const trustedImage = join(trustedAgentRoot, "artifacts", "screenshot.png");
  const untrustedRoot = join(tempDir, "other-home");
  const untrustedImage = join(untrustedRoot, "screenshot.png");

  try {
    await mkdir(workspacePath, {
      recursive: true
    });
    await mkdir(join(trustedAgentRoot, "artifacts"), {
      recursive: true
    });
    await mkdir(untrustedRoot, {
      recursive: true
    });

    await writeFile(trustedImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(untrustedImage, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const app = express();

    installAssetRoutes(app, {
      trustedImageRoots: [trustedAgentRoot],
      workspaces: {
        listWorkspaces: () => [
          {
            path: workspacePath
          }
        ]
      }
    });

    await withServer(app, async (baseUrl) => {
      const allowed = await fetch(
        `${baseUrl}/api/assets/local-image?path=${encodeURIComponent(trustedImage)}`
      );
      const denied = await fetch(
        `${baseUrl}/api/assets/local-image?path=${encodeURIComponent(untrustedImage)}`
      );

      assert.equal(allowed.status, 200);
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), {
        error: "Local images are only available from registered workspaces or trusted temporary directories."
      });
    });
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("asset ticket opens a scoped asset URL and preserves download filename", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "deskcue-assets-"));
  const workspacePath = join(tempDir, "workspace");
  const allowedFile = join(workspacePath, "report.txt");

  try {
    await mkdir(workspacePath, {
      recursive: true
    });

    await writeFile(allowedFile, "report", "utf8");

    const app = express();

    app.use(express.json());

    installAssetRoutes(app, {
      workspaces: {
        listWorkspaces: () => [
          {
            path: workspacePath
          }
        ]
      }
    });

    await withServer(app, async (baseUrl) => {
      const ticketResponse = await fetch(`${baseUrl}/api/assets/ticket`, {
        body: JSON.stringify({
          download: true,
          kind: "file",
          path: allowedFile
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });
      const ticketPayload = await ticketResponse.json() as {
        expiresAt: string;
        url: string;
      };

      const assetResponse = await fetch(`${baseUrl}${ticketPayload.url}`);
      const expiredResponse = await fetch(`${baseUrl}/api/assets/ticket/missing-ticket`, {
        headers: {
          accept: "text/html"
        }
      });

      assert.equal(ticketResponse.status, 201);
      assert.equal(assetResponse.status, 200);
      assert.equal(await assetResponse.text(), "report");
      assert.match(
        assetResponse.headers.get("content-disposition") ?? "",
        /filename="report\.txt"/
      );

      assert.ok(new Date(ticketPayload.expiresAt).getTime() > Date.now());
      assert.equal(expiredResponse.status, 404);
      assert.match(await expiredResponse.text(), /File link expired/);
    });
  } finally {
    await rm(tempDir, {
      force: true,
      recursive: true
    });
  }
});
