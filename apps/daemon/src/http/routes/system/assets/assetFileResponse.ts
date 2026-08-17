import type express from "express";
import path from "node:path";

// AssetAccessPolicy has already canonicalized and authorized the path. Express
// must not reject trusted agent roots merely because they contain `.codex` or
// another hidden directory segment.
const AUTHORIZED_ASSET_SEND_OPTIONS = {
  dotfiles: "allow" as const
};

export function sendLocalAssetFile(
  response: express.Response,
  normalizedPath: string,
  download: boolean
) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  const onComplete = (error?: Error & { statusCode?: number }) => {
    if (!error || response.headersSent) {
      return;
    }

    response.status(typeof error.statusCode === "number" ? error.statusCode : 404).json({
      error: "Local asset not found."
    });
  };

  if (download || path.extname(normalizedPath).toLowerCase() === ".svg") {
    response.download(
      normalizedPath,
      path.basename(normalizedPath),
      AUTHORIZED_ASSET_SEND_OPTIONS,
      onComplete
    );
    return;
  }

  response.sendFile(normalizedPath, AUTHORIZED_ASSET_SEND_OPTIONS, onComplete);
}

export function sendExpiredAssetTicketResponse(
  request: express.Request,
  response: express.Response
) {
  const message = "This temporary DeskCue file link expired. Open the asset again from DeskCue.";
  if (request.accepts(["html", "json"]) === "html") {
    response
      .status(404)
      .type("html")
      .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DeskCue file link expired</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #111216;
      color: #f3eee5;
      font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(420px, calc(100vw - 48px));
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      background: #18191f;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
    }
    p {
      margin: 0;
      color: #b9c2d8;
    }
  </style>
</head>
<body>
  <main>
    <h1>File link expired</h1>
    <p>${message}</p>
  </main>
</body>
</html>`);
    return;
  }

  response.status(404).json({
    error: message
  });
}
