import type { LmStudioInstalledModel } from "@deskcue/protocol";
import { AppError } from "#application/errors";

export type LmStudioModelCatalogEntry = LmStudioInstalledModel & {
  aliases: readonly string[];
};

function normalizeLmStudioModelReference(value: string) {
  return value.trim().replaceAll("\\", "/").toLocaleLowerCase("en-US");
}

function stripLmStudioVariant(value: string) {
  return value.replace(/@[^/]+$/u, "").trim();
}

export function resolveLmStudioInstalledModel(model: string, models: readonly LmStudioModelCatalogEntry[]) {
  const normalizedModel = normalizeLmStudioModelReference(model);
  const resolved = models.find((candidate) => candidate.aliases.includes(normalizedModel));

  if (!resolved) {
    throw new AppError(
      "invalid_input",
      "This LM Studio chat is not linked to an exact locally installed model. Choose a local model before sending."
    );
  }

  return {
    displayName: resolved.displayName,
    modelKey: resolved.modelKey,
    path: resolved.path
  };
}

export function resolveLmStudioInstalledModelOrNull(
  model: string,
  models: readonly LmStudioModelCatalogEntry[]
) {
  const normalizedModel = normalizeLmStudioModelReference(model);
  const resolved = models.find((candidate) => candidate.aliases.includes(normalizedModel));

  return resolved
    ? { displayName: resolved.displayName, modelKey: resolved.modelKey, path: resolved.path }
    : null;
}

export function parseLmStudioModelCatalog(value: string): LmStudioModelCatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new AppError("runtime_unavailable", "DeskCue could not read the locally installed LM Studio models.");
  }

  if (!Array.isArray(parsed)) {
    throw new AppError("runtime_unavailable", "LM Studio returned an invalid local model catalog.");
  }

  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];

    const candidate = entry as {
      displayName?: unknown;
      modelKey?: unknown;
      path?: unknown;
      selectedVariant?: unknown;
      type?: unknown;
      variants?: unknown;
    };

    if ((candidate.type !== "llm" && candidate.type !== "vlm") ||
      typeof candidate.displayName !== "string" ||
      typeof candidate.modelKey !== "string" ||
      typeof candidate.path !== "string" ||
      !candidate.displayName.trim() || !candidate.modelKey.trim() || !candidate.path.trim()) {
      return [];
    }

    const displayName = candidate.displayName.trim();
    const modelKey = candidate.modelKey.trim();
    const modelPath = candidate.path.trim();
    const variants = Array.isArray(candidate.variants)
      ? candidate.variants.filter((variant): variant is string => typeof variant === "string" && Boolean(variant.trim()))
      : [];
    const selectedVariant = typeof candidate.selectedVariant === "string" && candidate.selectedVariant.trim()
      ? candidate.selectedVariant.trim()
      : null;
    return [{
      aliases: [...new Set([
        modelKey,
        modelPath,
        displayName,
        selectedVariant,
        ...variants,
        stripLmStudioVariant(modelKey),
        stripLmStudioVariant(modelPath)
      ].filter((reference): reference is string => Boolean(reference)).map(normalizeLmStudioModelReference))],
      displayName,
      modelKey,
      path: modelPath
    }];
  });
}

export function parseLmStudioInstalledModels(value: string): LmStudioInstalledModel[] {
  return parseLmStudioModelCatalog(value).map(({ aliases: _aliases, ...model }) => model);
}
