import type express from "express";

import type {
  LmStudioInstalledModel,
  LmStudioPrepareResponse,
  LmStudioServerStartResponse,
  OllamaServerStartResponse,
  OllamaInstalledModel
} from "@deskcue/protocol";
import { parsePrepareLmStudioModelInput } from "@deskcue/protocol";
import type { LmStudioRuntimeCoordinator } from "#runtimeDiagnostics/lmStudioRuntimeCoordinator";
import {
  listLmStudioModels,
  prepareLmStudioModel,
  startLmStudioServer
} from "#runtimeDiagnostics/lmStudioServer";
import { listOllamaModels } from "#runtimeDiagnostics/ollama";
import { startOllamaServer } from "#runtimeDiagnostics/ollamaServer";
import { listRuntimes } from "#runtimeDiagnostics/runtimes";

import { readProtocolPayload } from "../../../middleware/validators.ts";

type InstallRuntimeRoutesOptions = {
  lmStudioRuntime?: Pick<
    LmStudioRuntimeCoordinator,
    "listModels" | "prepareModel" | "startServer"
  >;
  listLmStudioModels?: typeof listLmStudioModels;
  listOllamaModels?: typeof listOllamaModels;
  listRuntimes?: typeof listRuntimes;
  prepareLmStudioModel?: typeof prepareLmStudioModel;
  startLmStudioServer?: typeof startLmStudioServer;
  startOllamaServer?: typeof startOllamaServer;
};

export function installRuntimeRoutes(
  app: express.Express,
  {
    lmStudioRuntime,
    listRuntimes: listRuntimesForRoute = listRuntimes,
    listLmStudioModels: listLmStudioModelsForRoute = listLmStudioModels,
    listOllamaModels: listOllamaModelsForRoute = listOllamaModels,
    startLmStudioServer: startLmStudioServerForRoute = startLmStudioServer,
    startOllamaServer: startOllamaServerForRoute = startOllamaServer,
    prepareLmStudioModel: prepareLmStudioModelForRoute = prepareLmStudioModel
  }: InstallRuntimeRoutesOptions = {}
) {
  const listModels = lmStudioRuntime?.listModels.bind(lmStudioRuntime) ?? listLmStudioModelsForRoute;
  const prepareModel = lmStudioRuntime?.prepareModel.bind(lmStudioRuntime) ?? prepareLmStudioModelForRoute;
  const startServer = lmStudioRuntime?.startServer.bind(lmStudioRuntime) ?? startLmStudioServerForRoute;
  let ollamaStartFlight: Promise<OllamaServerStartResponse> | null = null;
  const startOllama = () => {
    if (ollamaStartFlight) return ollamaStartFlight;
    const flight = startOllamaServerForRoute();
    ollamaStartFlight = flight;
    void flight.finally(() => {
      if (ollamaStartFlight === flight) ollamaStartFlight = null;
    }).catch(() => {});
    return flight;
  };
  app.get("/api/runtimes", async (_request, response, next) => {
    try {
      const runtimes = await listRuntimesForRoute();
      response.json(runtimes);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runtimes/lm-studio/server/start", async (_request, response, next) => {
    try {
      const result: LmStudioServerStartResponse = await startServer();
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runtimes/ollama/server/start", async (_request, response, next) => {
    try {
      const result: OllamaServerStartResponse = await startOllama();
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/runtimes/lm-studio/models", async (_request, response, next) => {
    try {
      const models: LmStudioInstalledModel[] = await listModels();
      response.json({ models });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/runtimes/ollama/models", async (_request, response, next) => {
    try {
      const models: OllamaInstalledModel[] = await listOllamaModelsForRoute();
      response.json({ models });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/runtimes/lm-studio/prepare", async (request, response, next) => {
    try {
      const { model } = readProtocolPayload(() => parsePrepareLmStudioModelInput(request.body));
      const result: LmStudioPrepareResponse = await prepareModel(model);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });
}
