import {
  access,
  readFile,
  readdir,
  stat
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { logger } from "#infrastructure/logging/logger";

const DESKCUE_CODEX_PATH = process.env.DESKCUE_CODEX_PATH;
const DESKCUE_CODEX_MODEL = process.env.DESKCUE_CODEX_MODEL;
const OPENAI_CODEX_BIN_ROOT = path.join(os.homedir(), "AppData", "Local", "OpenAI", "Codex", "bin");
const CODEX_CONFIG_PATH = path.join(os.homedir(), ".codex", "config.toml");

export function chooseCodexModel(input: {
  configuredModel?: string | null;
  overrideModel?: string | null;
  sessionModel?: string | null;
}) {
  for (const model of [input.overrideModel, input.sessionModel, input.configuredModel]) {
    if (model?.trim()) {
      return model.trim();
    }
  }
  return null;
}

export async function resolvePreferredCodexModel(sessionModel: string | null = null) {
  const resumeModel = chooseCodexModel({
    overrideModel: DESKCUE_CODEX_MODEL,
    sessionModel
  });
  if (resumeModel) {
    return resumeModel;
  }

  try {
    const configContent = await readFile(CODEX_CONFIG_PATH, "utf8");
    const match = configContent.match(/^\s*model\s*=\s*"([^"\r\n]+)"/m);
    return chooseCodexModel({ configuredModel: match?.[1] });
  } catch (error) {
    logger.warn("Failed to resolve preferred Codex model", {
      configPath: CODEX_CONFIG_PATH,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  return null;
}

async function collectCodexExecutables(rootPath: string): Promise<Array<{ filePath: string; lastModifiedMs: number }>> {
  const entries = await readdir(rootPath, {
    withFileTypes: true
  });
  const candidates: Array<{ filePath: string; lastModifiedMs: number }> = [];

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      const nestedExecutable = path.join(entryPath, "codex.exe");
      try {
        const fileStat = await stat(nestedExecutable);
        if (fileStat.isFile()) {
          candidates.push({
            filePath: nestedExecutable,
            lastModifiedMs: fileStat.mtimeMs
          });
        }
      } catch {
        // Ignore version directories without a Codex executable.
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase() === "codex.exe") {
      const fileStat = await stat(entryPath);
      candidates.push({
        filePath: entryPath,
        lastModifiedMs: fileStat.mtimeMs
      });
    }
  }

  return candidates;
}

export async function resolvePreferredCodexExecutable() {
  if (DESKCUE_CODEX_PATH) {
    try {
      await access(DESKCUE_CODEX_PATH);
      return DESKCUE_CODEX_PATH;
    } catch {
      logger.warn("DESKCUE_CODEX_PATH is set but unavailable", {
        codexPath: DESKCUE_CODEX_PATH
      });
    }
  }

  try {
    const candidates = await collectCodexExecutables(OPENAI_CODEX_BIN_ROOT);
    if (candidates.length > 0) {
      candidates.sort((left, right) => right.lastModifiedMs - left.lastModifiedMs);
      return candidates[0].filePath;
    }
  } catch (error) {
    logger.warn("Failed to resolve preferred Codex executable", {
      codexRoot: OPENAI_CODEX_BIN_ROOT,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  return "codex";
}
