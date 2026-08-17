import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("daemon config uses DESKCUE_DATA_DIR for default data files", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-config-data-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
          "-e",
          [
            "import { daemonConfig } from './src/config/daemonConfig.ts';",
            "console.log(JSON.stringify({",
            "databaseFilePath: daemonConfig.databaseFilePath,",
            "stateFilePath: daemonConfig.stateFilePath",
            "}));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_DATABASE_FILE: undefined,
          DESKCUE_DATA_DIR: tempDir,
          DESKCUE_STATE_FILE: undefined
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

      const payload = JSON.parse(result.stdout.trim()) as {
        databaseFilePath?: string;
        stateFilePath?: string;
      };

      assert.equal(payload.databaseFilePath, join(tempDir, "service", "deskcue.sqlite"));
      assert.equal(payload.stateFilePath, join(tempDir, "service", "state.json"));
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("daemon config uses authenticated LAN-ready source-checkout defaults", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-config-default-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { daemonConfig } from './src/config/daemonConfig.ts';",
          "console.log(JSON.stringify({",
          "authRequired: daemonConfig.authRequired,",
          "bindHost: daemonConfig.bindHost,",
          "httpCompression: daemonConfig.httpCompression",
          "}));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_AUTH_REQUIRED: undefined,
          DESKCUE_BIND_HOST: undefined,
          DESKCUE_DATA_DIR: tempDir,
          DESKCUE_HTTP_COMPRESSION: undefined
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout.trim()) as {
      authRequired?: boolean;
      bindHost?: string;
      httpCompression?: string;
    };

    assert.equal(payload.authRequired, true);
    assert.equal(payload.bindHost, "0.0.0.0");
    assert.equal(payload.httpCompression, "auto");
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("daemon config can disable HTTP compression for edge-managed deployments", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-config-compression-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { daemonConfig } from './src/config/daemonConfig.ts';",
          "console.log(JSON.stringify({",
          "httpCompression: daemonConfig.httpCompression",
          "}));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_DATA_DIR: tempDir,
          DESKCUE_HTTP_COMPRESSION: "off"
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout.trim()) as {
      httpCompression?: string;
    };

    assert.equal(payload.httpCompression, "off");
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("daemon config bounds local LLM generation concurrency and its wait queue", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-config-local-llm-concurrency-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { daemonConfig } from './src/config/daemonConfig.ts';",
          "console.log(JSON.stringify({",
          "concurrency: daemonConfig.localLlmMaxConcurrentGenerations,",
          "queueCapacity: daemonConfig.localLlmGenerationQueueCapacity",
          "}));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_DATA_DIR: tempDir,
          DESKCUE_LOCAL_LLM_GENERATION_QUEUE_CAPACITY: "7",
          DESKCUE_LOCAL_LLM_MAX_CONCURRENT_GENERATIONS: "3"
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      concurrency: 3,
      queueCapacity: 7
    });
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("daemon config derives public host origins from the daemon port", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-config-public-host-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { daemonConfig } from './src/config/daemonConfig.ts';",
          "console.log(JSON.stringify({",
          "allowedRuntimeOrigins: daemonConfig.allowedOrigins,",
          "daemonPort: daemonConfig.daemonPort",
          "}));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_DAEMON_PORT: "44100",
          DESKCUE_DATA_DIR: tempDir,
          DESKCUE_PUBLIC_HOST: "deskcue-lan.local"
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout.trim()) as {
      allowedRuntimeOrigins?: string[];
      daemonPort?: number;
    };

    assert.equal(payload.daemonPort, 44100);
    assert.equal(payload.allowedRuntimeOrigins?.includes("http://deskcue-lan.local:44100"), true);
    assert.equal(payload.allowedRuntimeOrigins?.includes("http://deskcue-lan.local:4173"), false);
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("daemon web settings override matching DESKCUE env defaults", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-config-web-"));
  mkdirSync(tempDir, {
    recursive: true
  });
  writeFileSync(
    join(tempDir, "daemon-settings.json"),
    JSON.stringify({
      allowedOrigins: ["http://from-web.example:4173"],
      authRequired: false,
      pairingHosts: ["https://phone.example", "deskcue.local:4173"],
      publicHost: "web.example"
    }),
    "utf8"
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { daemonConfig, readDaemonSettings } from './src/config/daemonConfig.ts';",
          "const settings = readDaemonSettings();",
          "console.log(JSON.stringify({",
          "allowedRuntimeOrigins: daemonConfig.allowedOrigins,",
          "allowedOrigins: daemonConfig.configuredAllowedOrigins,",
          "authRequired: daemonConfig.authRequired,",
          "pairingHosts: daemonConfig.pairingHosts,",
          "publicHost: daemonConfig.publicHost,",
          "sources: settings.sources",
          "}));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_ALLOWED_ORIGINS: "http://from-env.example:4173",
          DESKCUE_AUTH_REQUIRED: "true",
          DESKCUE_DATA_DIR: tempDir,
          DESKCUE_PUBLIC_HOST: "env.example"
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout.trim()) as {
      allowedOrigins?: string[];
      allowedRuntimeOrigins?: string[];
      authRequired?: boolean;
      pairingHosts?: string[];
      publicHost?: string | null;
      sources?: {
        allowedOrigins?: {
          envValue?: string[] | null;
          source?: string;
          webValue?: string[] | null;
        };
        authRequired?: {
          envValue?: boolean | null;
          source?: string;
          webValue?: boolean | null;
        };
        pairingHosts?: {
          source?: string;
          webValue?: string[] | null;
        };
        publicHost?: {
          envValue?: string | null;
          source?: string;
          webValue?: string | null;
        };
      };
    };

    assert.deepEqual(payload.allowedOrigins, ["http://from-web.example:4173"]);
    assert.deepEqual(payload.pairingHosts, ["https://phone.example", "http://deskcue.local:4173"]);
    assert.equal(payload.allowedRuntimeOrigins?.includes("http://web.example:4100"), true);
    assert.equal(payload.allowedRuntimeOrigins?.includes("https://phone.example"), true);
    assert.equal(payload.allowedRuntimeOrigins?.includes("http://deskcue.local:4173"), true);
    assert.equal(payload.authRequired, false);
    assert.equal(payload.publicHost, "web.example");
    assert.equal(payload.sources?.allowedOrigins?.source, "web");
    assert.deepEqual(payload.sources?.allowedOrigins?.envValue, ["http://from-env.example:4173"]);
    assert.deepEqual(payload.sources?.allowedOrigins?.webValue, ["http://from-web.example:4173"]);
    assert.equal(payload.sources?.authRequired?.source, "web");
    assert.equal(payload.sources?.authRequired?.envValue, true);
    assert.equal(payload.sources?.authRequired?.webValue, false);
    assert.equal(payload.sources?.pairingHosts?.source, "web");
    assert.deepEqual(payload.sources?.pairingHosts?.webValue, ["https://phone.example", "http://deskcue.local:4173"]);
    assert.equal(payload.sources?.publicHost?.source, "web");
    assert.equal(payload.sources?.publicHost?.envValue, "env.example");
    assert.equal(payload.sources?.publicHost?.webValue, "web.example");
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

test("daemon settings reset removes web overrides and restores env values", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-config-reset-"));
  const settingsFilePath = join(tempDir, "daemon-settings.json");
  mkdirSync(tempDir, {
    recursive: true
  });
  writeFileSync(
    settingsFilePath,
    JSON.stringify({
      allowedOrigins: ["http://from-web.example:4173"],
      authRequired: false,
      pairingHosts: ["https://phone.example"],
      publicHost: "web.example"
    }),
    "utf8"
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { existsSync } from 'node:fs';",
          "import { daemonConfig, resetDaemonSettings } from './src/config/daemonConfig.ts';",
          "const settings = resetDaemonSettings();",
          "console.log(JSON.stringify({",
          "allowedOrigins: daemonConfig.configuredAllowedOrigins,",
          "authRequired: daemonConfig.authRequired,",
          "exists: existsSync(daemonConfig.settingsFilePath),",
          "pairingHosts: daemonConfig.pairingHosts,",
          "publicHost: daemonConfig.publicHost,",
          "sources: settings.sources",
          "}));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          DESKCUE_ALLOWED_ORIGINS: "http://from-env.example:4173",
          DESKCUE_AUTH_REQUIRED: "true",
          DESKCUE_DATA_DIR: tempDir,
          DESKCUE_PUBLIC_HOST: "env.example"
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout.trim()) as {
      allowedOrigins?: string[];
      authRequired?: boolean;
      exists?: boolean;
      pairingHosts?: string[];
      publicHost?: string | null;
      sources?: {
        allowedOrigins?: {
          source?: string;
          webValue?: string[] | null;
        };
        authRequired?: {
          source?: string;
          webValue?: boolean | null;
        };
        pairingHosts?: {
          source?: string;
          webValue?: string[] | null;
        };
        publicHost?: {
          source?: string;
          webValue?: string | null;
        };
      };
    };

    assert.deepEqual(payload.allowedOrigins, ["http://from-env.example:4173"]);
    assert.equal(payload.authRequired, true);
    assert.equal(payload.exists, false);
    assert.deepEqual(payload.pairingHosts, []);
    assert.equal(payload.publicHost, "env.example");
    assert.equal(payload.sources?.allowedOrigins?.source, "env");
    assert.equal(payload.sources?.allowedOrigins?.webValue, null);
    assert.equal(payload.sources?.authRequired?.source, "env");
    assert.equal(payload.sources?.authRequired?.webValue, null);
    assert.equal(payload.sources?.pairingHosts?.source, "default");
    assert.deepEqual(payload.sources?.pairingHosts?.webValue, null);
    assert.equal(payload.sources?.publicHost?.source, "env");
    assert.equal(payload.sources?.publicHost?.webValue, null);
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});

type AgentDataRootsPayload = {
  claudeHome: string;
  codexHome: string;
  lmStudioHome: string;
};

type RuntimeEndpointsPayload = {
  lmStudioEndpoint: string;
  ollamaEndpoint: string;
};

type SettingsSourcesPayload = Record<
  string,
  {
    source: "default" | "env" | "web";
  }
>;

test("daemon settings update and reset preserve singleton identity and source precedence", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deskcue-config-mutable-singleton-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=deskcue-source",
        "--import",
        "tsx",
        "-e",
        [
          "import { readFileSync } from 'node:fs';",
          "import { daemonConfig, resetDaemonSettings, updateDaemonSettings } from './src/config/daemonConfig.ts';",
          "const singleton = daemonConfig;",
          "const updated = updateDaemonSettings({",
          "allowedOrigins: [' https://deskcue.example/path ', 'https://deskcue.example'],",
          "authRequired: false,",
          "pairingHosts: ['phone.local:4443'],",
          "publicHost: 'deskcue.local',",
          "storageMaxMb: 75,",
          "agentDataRoots: { claudeHome: './web-claude' },",
          "runtimeEndpoints: { lmStudioEndpoint: 'localhost:5678/v1/' }",
          "});",
          "const persisted = JSON.parse(readFileSync(daemonConfig.settingsFilePath, 'utf8'));",
          "const updatedSnapshot = {",
          "agentDataRoots: daemonConfig.agentDataRoots,",
          "allowedOrigins: daemonConfig.allowedOrigins,",
          "authRequired: daemonConfig.authRequired,",
          "runtimeEndpointOverrides: daemonConfig.runtimeEndpointOverrides,",
          "runtimeEndpoints: daemonConfig.runtimeEndpoints,",
          "sources: updated.sources,",
          "storageMaxBytes: daemonConfig.storageMaxBytes",
          "};",
          "const reset = resetDaemonSettings();",
          "console.log(JSON.stringify({",
          "persisted,",
          "reset: {",
          "agentDataRoots: daemonConfig.agentDataRoots,",
          "authRequired: daemonConfig.authRequired,",
          "runtimeEndpointOverrides: daemonConfig.runtimeEndpointOverrides,",
          "runtimeEndpoints: daemonConfig.runtimeEndpoints,",
          "sources: reset.sources",
          "},",
          "sameSingletonAfterReset: singleton === daemonConfig,",
          "updated: updatedSnapshot",
          "}));"
        ].join("")
      ],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: undefined,
          CODEX_HOME: join(tempDir, "env-codex"),
          DESKCUE_ALLOWED_ORIGINS: "http://env-origin.example:4100",
          DESKCUE_AUTH_REQUIRED: "true",
          DESKCUE_DATA_DIR: tempDir,
          DESKCUE_LM_STUDIO_ENDPOINT: undefined,
          DESKCUE_OLLAMA_ENDPOINT: "localhost:11435",
          DESKCUE_PUBLIC_HOST: "env-host.local",
          LM_STUDIO_ENDPOINT: undefined,
          LM_STUDIO_HOME: undefined,
          OLLAMA_HOST: undefined
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const payload = JSON.parse(result.stdout.trim()) as {
      persisted: {
        allowedOrigins?: string[];
        agentDataRoots?: { claudeHome?: string };
        runtimeEndpoints?: { lmStudioEndpoint?: string };
      };
      reset: {
        agentDataRoots: AgentDataRootsPayload;
        authRequired: boolean;
        runtimeEndpointOverrides: Record<string, string>;
        runtimeEndpoints: RuntimeEndpointsPayload;
        sources: SettingsSourcesPayload;
      };
      sameSingletonAfterReset: boolean;
      updated: {
        agentDataRoots: AgentDataRootsPayload;
        allowedOrigins: string[];
        authRequired: boolean;
        runtimeEndpointOverrides: Record<string, string>;
        runtimeEndpoints: RuntimeEndpointsPayload;
        sources: SettingsSourcesPayload;
        storageMaxBytes: number;
      };
    };

    assert.equal(payload.sameSingletonAfterReset, true);
    assert.equal(payload.updated.authRequired, false);
    assert.equal(payload.updated.storageMaxBytes, 75 * 1024 * 1024);
    assert.deepEqual(payload.persisted.allowedOrigins, ["https://deskcue.example"]);
    assert.equal(payload.persisted.agentDataRoots?.claudeHome, "web-claude");
    assert.equal(
      payload.persisted.runtimeEndpoints?.lmStudioEndpoint,
      "http://localhost:5678/v1"
    );
    assert.equal(payload.updated.agentDataRoots.codexHome, join(tempDir, "env-codex"));
    assert.equal(payload.updated.agentDataRoots.claudeHome, "web-claude");
    assert.equal(payload.updated.runtimeEndpoints.ollamaEndpoint, "http://localhost:11435");
    assert.equal(payload.updated.runtimeEndpoints.lmStudioEndpoint, "http://localhost:5678/v1");
    assert.deepEqual(payload.updated.runtimeEndpointOverrides, {
      lmStudioEndpoint: "http://localhost:5678/v1",
      ollamaEndpoint: "http://localhost:11435"
    });
    assert.equal(payload.updated.allowedOrigins.includes("https://deskcue.example"), true);
    assert.equal(payload.updated.allowedOrigins.includes("http://deskcue.local:4100"), true);
    assert.equal(payload.updated.allowedOrigins.includes("http://phone.local:4443"), true);
    assert.equal(payload.updated.sources.authRequired.source, "web");
    assert.equal(payload.updated.sources.agentDataRoots.source, "web");
    assert.equal(payload.updated.sources.runtimeEndpoints.source, "web");

    assert.equal(payload.reset.authRequired, true);
    assert.equal(payload.reset.agentDataRoots.codexHome, join(tempDir, "env-codex"));
    assert.equal(payload.reset.runtimeEndpoints.ollamaEndpoint, "http://localhost:11435");
    assert.deepEqual(payload.reset.runtimeEndpointOverrides, {
      ollamaEndpoint: "http://localhost:11435"
    });
    assert.equal(payload.reset.sources.authRequired.source, "env");
    assert.equal(payload.reset.sources.agentDataRoots.source, "env");
    assert.equal(payload.reset.sources.runtimeEndpoints.source, "env");
  } finally {
    rmSync(tempDir, {
      force: true,
      recursive: true
    });
  }
});
