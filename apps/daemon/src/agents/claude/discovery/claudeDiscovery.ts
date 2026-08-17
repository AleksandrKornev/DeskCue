import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { claudeCodeAdapter } from "@deskcue/adapters";
import type {
  AgentSessionDetail,
  AgentSessionSourceVersion,
  AgentSessionSummary
} from "@deskcue/protocol";
import { daemonConfig } from "#config/daemonConfig";

import { readClaudeSummaryFile } from "./claudeSummaryFileReader.ts";
import {
  findStringField,
  firstTranscriptText,
  normalizeTimestamp,
  parseClaudeTranscript,
  safeParseJson
} from "../transcript/claudeTranscript.ts";

interface DiscoveryCache {
  projectsRoot: string;
  scannedAt: number;
  summaries: AgentSessionSummary[];
  filesById: Map<string, string>;
}

let discoveryCache: DiscoveryCache | null = null;

function findLatestDirectStringField(
  items: Record<string, unknown>[],
  fieldName: string
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value = items[index]?.[fieldName];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function findLatestTimestamp(items: Record<string, unknown>[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value = findStringField([items[index]], ["timestamp", "updated_at", "created_at"]);
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return null;
}

async function readClaudeSummary(filePath: string): Promise<AgentSessionSummary | null> {
  const summaryFile = await readClaudeSummaryFile(filePath);
  const lines = summaryFile.lines;
  if (lines.length === 0) return null;

  const sessionId = path.basename(filePath, ".jsonl");
  const parsed = lines
    .map((line) => safeParseJson<Record<string, unknown>>(line))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  const title =
    findLatestDirectStringField(parsed, "customTitle") ??
    findLatestDirectStringField(parsed, "aiTitle") ??
    findStringField(parsed, ["session_title", "title", "summary"]) ??
    firstTranscriptText(parsed, "user") ??
    `Claude session ${sessionId.slice(0, 8)}`;
  const workspacePath = findStringField(parsed, [
    "cwd",
    "working_directory",
    "workingDirectory",
    "project_dir",
    "projectDir"
  ]);
  const updatedAt = findLatestTimestamp(parsed) ?? new Date(summaryFile.mtimeMs).toISOString();
  const originator = findStringField(parsed, ["model", "model_name", "agent_type"]);
  const model = originator ?? null;

  return {
    id: `${claudeCodeAdapter.id}:${sessionId}`,
    agentId: "claude-code",
    agentLabel: claudeCodeAdapter.label,
    sourceSessionId: sessionId,
    title,
    workspacePath,
    workspaceName: workspacePath ? path.basename(workspacePath) || workspacePath : null,
    updatedAt: normalizeTimestamp(updatedAt),
    model,
    originator: model,
    cliVersion: null,
    source: "claude.projects",
    filePath,
    attachMode: workspacePath ? "resume" : "read_only",
    workState: "idle"
  };
}

async function buildFileSourceVersion(
  summary: AgentSessionSummary,
  filePath: string
): Promise<AgentSessionSourceVersion> {
  const fileStat = await stat(filePath);
  const sourceFileMtimeMs = fileStat.mtimeMs;
  const sourceFileSizeBytes = fileStat.size;

  return {
    summary,
    sourceFileMtimeMs,
    sourceFileSizeBytes,
    sourceVersion: JSON.stringify({
      filePath,
      sourceFileMtimeMs,
      sourceFileSizeBytes
    })
  };
}

async function getClaudeSessionVersionFromDiscovery(
  discovery: DiscoveryCache,
  sessionId: string
) {
  const summary = discovery.summaries.find((item) => item.sourceSessionId === sessionId);
  const filePath = discovery.filesById.get(sessionId);
  if (!summary || !filePath) return null;

  return buildFileSourceVersion(summary, filePath);
}

async function walkJsonlFiles(rootPath: string): Promise<string[]> {
  try {
    const entries = await readdir(rootPath, {
      withFileTypes: true
    });
    const files: string[] = [];

    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkJsonlFiles(entryPath)));
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(entryPath);
    }

    return files;
  } catch {
    return [];
  }
}

async function loadDiscoveryFromProjectsRoot(projectsRoot: string): Promise<DiscoveryCache> {
  const files = await walkJsonlFiles(projectsRoot);
  const summaries: AgentSessionSummary[] = [];
  const filesById = new Map<string, string>();

  for (const filePath of files) {
    const summary = await readClaudeSummary(filePath);
    if (!summary) continue;

    summaries.push(summary);
    filesById.set(summary.sourceSessionId, filePath);
  }

  summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    projectsRoot,
    scannedAt: Date.now(),
    summaries,
    filesById
  };
}

export async function listClaudeSessionsFromProjectsRoot(
  projectsRoot: string,
  limit = 50
): Promise<AgentSessionSummary[]> {
  const discovery = await loadDiscoveryFromProjectsRoot(projectsRoot);
  return discovery.summaries.slice(0, limit);
}

export async function getClaudeSessionVersionFromProjectsRoot(
  projectsRoot: string,
  sessionId: string
): Promise<AgentSessionSourceVersion | null> {
  const discovery = await loadDiscoveryFromProjectsRoot(projectsRoot);
  return getClaudeSessionVersionFromDiscovery(discovery, sessionId);
}

async function loadDiscovery(force = false) {
  const projectsRoot = path.join(daemonConfig.agentDataRoots.claudeHome, "projects");
  if (
    !force &&
    discoveryCache &&
    discoveryCache.projectsRoot === projectsRoot &&
    Date.now() - discoveryCache.scannedAt < daemonConfig.agentSessionDiscoveryCacheTtlMs
  ) {
    return discoveryCache;
  }

  const discovery = await loadDiscoveryFromProjectsRoot(projectsRoot);
  discoveryCache = {
    ...discovery,
    projectsRoot
  };

  return discoveryCache;
}

export async function listClaudeSessions(
  limit = 50,
  force = false
): Promise<AgentSessionSummary[]> {
  const discovery = await loadDiscovery(force);
  return discovery.summaries.slice(0, limit);
}

export async function getClaudeSessionDetail(
  sessionId: string,
  force = false,
  transcriptTail?: number,
  chatMessageTail?: number
): Promise<AgentSessionDetail | null> {
  const discovery = await loadDiscovery(force);
  const summary = discovery.summaries.find((item) => item.sourceSessionId === sessionId);
  const filePath = discovery.filesById.get(sessionId);
  if (!summary || !filePath) return null;

  return {
    ...summary,
    transcript: await parseClaudeTranscript(filePath, sessionId, {
      chatMessageTail,
      transcriptTail
    })
  };
}

export async function getClaudeSessionVersion(
  sessionId: string,
  force = false
): Promise<AgentSessionSourceVersion | null> {
  const discovery = await loadDiscovery(force);
  return getClaudeSessionVersionFromDiscovery(discovery, sessionId);
}

export async function getClaudeTranscriptFilePath(sessionId: string, force = false) {
  const discovery = await loadDiscovery(force);
  return discovery.filesById.get(sessionId) ?? null;
}
