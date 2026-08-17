import express from "express";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WEB_DIST_PATH = fileURLToPath(
  new URL("../../../../../web/dist/", import.meta.url)
);

type InstallWebAppRoutesOptions = {
  webDistPath?: string;
};

function isWebAppRouteRequest(request: express.Request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  return !request.path.startsWith("/api") && !request.path.startsWith("/ws");
}

function installMissingWebAppRoute(app: express.Express, webDistPath: string) {
  app.use((request, response, next) => {
    if (!isWebAppRouteRequest(request)) {
      next();
      return;
    }

    response
      .status(503)
      .type("text/plain")
      .send(
        [
          "DeskCue web app is not built.",
          "",
          "Run `npm run start` from the repository root, or build the dashboard with `npm run build --workspace @deskcue/web`.",
          `Expected web dist: ${webDistPath}`
        ].join("\n")
      );
  });
}

export function installWebAppRoutes(
  app: express.Express,
  options: InstallWebAppRoutesOptions = {}
) {
  const webDistPath = options.webDistPath ?? DEFAULT_WEB_DIST_PATH;
  const indexPath = join(webDistPath, "index.html");

  if (!existsSync(indexPath)) {
    installMissingWebAppRoute(app, webDistPath);
    return;
  }

  app.use(express.static(webDistPath, {
    fallthrough: true,
    index: false,
    maxAge: "1h",
    setHeaders(response, filePath) {
      if (filePath === indexPath) {
        response.setHeader("Cache-Control", "no-cache");
      }
    }
  }));

  app.use((request, response, next) => {
    if (!isWebAppRouteRequest(request)) {
      next();
      return;
    }

    if (extname(request.path)) {
      response.status(404).type("text/plain").send("Not found.");
      return;
    }

    response.sendFile(indexPath);
  });
}
