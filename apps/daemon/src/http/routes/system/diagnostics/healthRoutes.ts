import type express from "express";

export function installHealthRoutes(app: express.Express) {
  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true
    });
  });
}
