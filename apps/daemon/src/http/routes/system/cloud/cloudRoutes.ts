import type express from "express";

import {
  parseConnectCloudInput,
  parseStartCloudEnrollmentAttemptInput,
  parseUpdateCloudPermissionsInput,
  parseUpdateCloudSessionDisclosureInput
} from "@deskcue/protocol";
import type { CloudConnectorService } from "#infrastructure/cloud/cloudConnectorService";

export function installCloudRoutes(
  app: express.Express,
  cloud: CloudConnectorService
) {
  app.get("/api/cloud/connection", (_request, response) => {
    response.json(cloud.getStatus());
  });

  app.post("/api/cloud/connection", async (request, response, next) => {
    try {
      response.status(201).json(await cloud.connect(parseConnectCloudInput(request.body)));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/cloud/connection", async (_request, response, next) => {
    try {
      response.json(await cloud.disconnect());
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/cloud/connection/session-disclosure", async (request, response, next) => {
    try {
      response.json(await cloud.updateSessionLabelDisclosure(
        parseUpdateCloudSessionDisclosureInput(request.body)
      ));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/cloud/connection/permissions", async (request, response, next) => {
    try {
      response.json(await cloud.updatePermissions(
        parseUpdateCloudPermissionsInput(request.body)
      ));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/cloud/enrollment-attempt", (_request, response) => {
    response.json(cloud.getEnrollmentAttempt());
  });

  app.post("/api/cloud/enrollment-attempts", async (request, response, next) => {
    try {
      response.status(201).json(await cloud.createEnrollmentAttempt(
        parseStartCloudEnrollmentAttemptInput(request.body)
      ));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/cloud/enrollment-attempt", (_request, response) => {
    response.json(cloud.cancelEnrollmentAttempt());
  });
}
