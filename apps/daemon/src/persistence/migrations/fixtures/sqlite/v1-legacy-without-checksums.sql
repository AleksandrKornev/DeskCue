CREATE TABLE metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_workspaces_path ON workspaces(path);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  source_session_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_workspace_id ON sessions(workspace_id);
CREATE INDEX idx_sessions_source_session_id ON sessions(source_session_id);
CREATE INDEX idx_sessions_last_activity_at ON sessions(last_activity_at);

CREATE TABLE access_devices (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  last_ip TEXT,
  revoked_at TEXT
);

CREATE INDEX idx_access_devices_token_hash ON access_devices(token_hash);
CREATE INDEX idx_access_devices_revoked_at ON access_devices(revoked_at);

INSERT INTO metadata (key, value, updated_at)
VALUES ('schema_version', '1', '2026-06-24T00:00:00.000Z');

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (1, 'initial workspace, session and access device tables', '2026-06-24T00:00:00.000Z');

INSERT INTO workspaces (id, name, path, created_at, json, updated_at)
VALUES (
  'workspace-fixture',
  'Fixture Workspace',
  'C:\deskcue-fixture',
  '2026-06-24T00:00:00.000Z',
  '{"id":"workspace-fixture","name":"Fixture Workspace","path":"C:\\deskcue-fixture","isGitRepo":true,"branch":"main","createdAt":"2026-06-24T00:00:00.000Z"}',
  '2026-06-24T00:00:00.000Z'
);

INSERT INTO sessions (
  id,
  workspace_id,
  adapter_id,
  source_session_id,
  status,
  started_at,
  last_activity_at,
  json,
  updated_at
)
VALUES (
  'session-fixture',
  'workspace-fixture',
  'generic-cli',
  NULL,
  'done',
  '2026-06-24T00:00:00.000Z',
  '2026-06-24T00:00:01.000Z',
  '{"id":"session-fixture","workspaceId":"workspace-fixture","workspaceName":"Fixture Workspace","adapterId":"generic-cli","sourceSessionId":null,"command":"echo fixture","status":"done","startedAt":"2026-06-24T00:00:00.000Z","finishedAt":"2026-06-24T00:00:01.000Z","lastActivityAt":"2026-06-24T00:00:01.000Z","exitCode":0,"preview":{"port":null},"replyState":{"status":"idle"},"git":{"isGitRepo":true,"branch":"main","isDirty":false,"changedFiles":[],"diff":"","lastUpdatedAt":"2026-06-24T00:00:01.000Z"},"logs":[],"inputHistory":[]}',
  '2026-06-24T00:00:01.000Z'
);
