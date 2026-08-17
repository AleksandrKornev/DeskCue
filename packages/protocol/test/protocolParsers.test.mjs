import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKCUE_PROTOCOL_CAPABILITIES,
  DESKCUE_PROTOCOL_VERSION,
  ProtocolSchemaError,
  compactAgentTranscriptSourceRefs,
  countAgentTranscriptSourceRefs,
  doAgentTranscriptSourceRefsOverlap,
  expandAgentTranscriptSourceRanges,
  isCompatibleProtocolMetadata,
  parseCapturePreviewArtifactPayload,
  parseClientEvent,
  parseCreateLocalLlmChatInput,
  parseCreateSessionInput,
  parseCreateWorkspaceInput,
  parseExternalForceStopPayload,
  parseIssuePreviewTicketInput,
  parsePreviewCandidatesResponse,
  parsePreviewTicketResponse,
  parseNotificationTestInput,
  parseOllamaModelsResponse,
  parsePrepareLmStudioModelInput,
  parseListPushSubscriptionsInput,
  parsePushSubscriptionId,
  parseRegisterPushSubscriptionInput,
  parseRemovePushSubscriptionInput,
  parseResumeAgentSessionInput,
  parseSaveLocalLlmPendingPromptInput,
  parseServerEvent,
  parseSendLocalLlmChatMessageInput,
  parseSendInputPayload,
  parseSetPreviewPortPayload,
  parseTelegramNotificationPairingResolveInput,
  parseUpdateLocalLlmChatAgentModeInput,
  parseUpdateLocalLlmChatPreviewInput,
  parseUpdateNotificationSettingsInput,
  parseWorkspaceDirectoryQuery,
  parseWorkspaceFileQuery
} from "../dist/index.js";

test("preview ticket input is owner-scoped and normalized", () => {
  assert.deepEqual(parseIssuePreviewTicketInput({
    kind: "local-llm",
    ownerId: " chat-1 "
  }), {
    kind: "local-llm",
    ownerId: "chat-1"
  });
  assert.throws(
    () => parseIssuePreviewTicketInput({ kind: "external", ownerId: "chat-1" }),
    ProtocolSchemaError
  );
  assert.throws(
    () => parseIssuePreviewTicketInput({ kind: "session", ownerId: " " }),
    ProtocolSchemaError
  );
});

test("preview responses are bounded and wire-validated", () => {
  assert.deepEqual(parsePreviewCandidatesResponse({
    candidates: [{ configured: false, port: 5173 }]
  }), {
    candidates: [{ configured: false, port: 5173 }]
  });
  assert.deepEqual(parsePreviewTicketResponse({
    credentialRevision: "abcdefghijklmnop",
    expiresAt: "2026-08-07T09:00:00.000Z",
    previewUrl: "/api/preview/sessions/session-1/"
  }), {
    credentialRevision: "abcdefghijklmnop",
    expiresAt: "2026-08-07T09:00:00.000Z",
    previewUrl: "/api/preview/sessions/session-1/"
  });
  assert.deepEqual(parsePreviewTicketResponse({
    credentialRevision: "abcdefghijklmnop",
    expiresAt: "2026-08-07T09:00:00.000Z",
    previewUrl: "http://deskcue.test:4101/api/preview/sessions/session-1/"
  }), {
    credentialRevision: "abcdefghijklmnop",
    expiresAt: "2026-08-07T09:00:00.000Z",
    previewUrl: "http://deskcue.test:4101/api/preview/sessions/session-1/"
  });
  assert.throws(
    () => parsePreviewCandidatesResponse({
      candidates: [
        { configured: false, port: 5173 },
        { configured: true, port: 5173 }
      ]
    }),
    ProtocolSchemaError
  );
  assert.throws(
    () => parsePreviewTicketResponse({
      credentialRevision: "abcdefghijklmnop",
      expiresAt: "never",
      previewUrl: "http://example.test/"
    }),
    ProtocolSchemaError
  );
  assert.throws(
    () => parsePreviewTicketResponse({
      credentialRevision: "abcdefghijklmnop",
      expiresAt: "2026-08-07T09:00:00.000Z",
      previewUrl: "http://user:secret@deskcue.test:4101/api/preview/sessions/session-1/"
    }),
    ProtocolSchemaError
  );
  assert.throws(
    () => parsePreviewTicketResponse({
      credentialRevision: "abcdefghijklmnop",
      expiresAt: "2026-08-07T09:00:00.000Z",
      previewUrl: "/api/preview/sessions/session-1/?deskcuePreviewTicket=secret"
    }),
    ProtocolSchemaError
  );
  assert.throws(
    () => parsePreviewTicketResponse({
      credentialRevision: "raw-ticket-must-not-be-accepted",
      expiresAt: "2026-08-07T09:00:00.000Z",
      previewUrl: "/api/preview/sessions/session-1/"
    }),
    ProtocolSchemaError
  );
});

test("session command parsers preserve accepted wire values", () => {
  assert.deepEqual(parseCreateWorkspaceInput({ path: "  D:\\workspace  " }), {
    path: "  D:\\workspace  "
  });
  assert.deepEqual(
    parseCreateSessionInput({
      command: " npm run start ",
      workspaceId: "workspace-1"
    }),
    {
      command: " npm run start ",
      workspaceId: "workspace-1"
    }
  );
  assert.deepEqual(parseSendInputPayload({ input: "  continue  " }), {
    input: "  continue  "
  });
  assert.deepEqual(parseResumeAgentSessionInput({}), {
    prompt: undefined
  });
});

test("session command parsers preserve validation and normalization semantics", () => {
  assert.deepEqual(
    parseExternalForceStopPayload({
      processCreatedAt: " 2026-08-05T00:00:00.000Z ",
      processId: 42
    }),
    {
      processCreatedAt: "2026-08-05T00:00:00.000Z",
      processId: 42
    }
  );
  assert.deepEqual(parseSetPreviewPortPayload({ port: null }), { port: null });
  assert.deepEqual(parseSetPreviewPortPayload({ port: 65535 }), { port: 65535 });
  assert.deepEqual(
    parseSetPreviewPortPayload({ port: 5173, networkMode: "deskcue-host" }),
    { port: 5173, networkMode: "deskcue-host" }
  );
  assert.deepEqual(parseCapturePreviewArtifactPayload({ viewport: "mobile" }), {
    viewport: "mobile"
  });

  assert.throws(
    () => parseExternalForceStopPayload({ processCreatedAt: "now", processId: 0 }),
    (error) =>
      error instanceof ProtocolSchemaError &&
      error.message === "Field processId must be a positive safe integer."
  );
  assert.throws(
    () => parseSetPreviewPortPayload({ port: 65536 }),
    (error) =>
      error instanceof ProtocolSchemaError &&
      error.message === "Field port must be an integer between 1 and 65535, or null."
  );
  assert.throws(
    () => parseSetPreviewPortPayload({ port: 5173, networkMode: "open-proxy" }),
    ProtocolSchemaError
  );
});

test("realtime client parser preserves ack and presence wire shapes", () => {
  assert.deepEqual(
    parseClientEvent({
      clientId: "client-1",
      cursor: " 42 ",
      type: "ack"
    }),
    {
      clientId: "client-1",
      cursor: " 42 ",
      type: "ack"
    }
  );
  assert.deepEqual(
    parseClientEvent({
      clientId: "",
      sessionId: null,
      sessionTab: null,
      type: "presence"
    }),
    {
      sessionId: null,
      sessionTab: null,
      type: "presence"
    }
  );

  assert.throws(
    () => parseClientEvent({ cursor: " ", type: "ack" }),
    (error) =>
      error instanceof ProtocolSchemaError &&
      error.message === "Client ack event must include a cursor."
  );
});

test("realtime server parser rejects malformed wire events", () => {
  const event = {
    cursor: "cursor-1",
    type: "local.llm.chat.updated",
    payload: {
      chatId: "chat-1",
      terminal: false
    }
  };
  assert.deepEqual(parseServerEvent(event), event);
  assert.throws(
    () => parseServerEvent({ ...event, payload: { chatId: "chat-1" } }),
    (error) =>
      error instanceof ProtocolSchemaError &&
      error.message === "Server event field terminal must be a boolean."
  );
  assert.throws(
    () => parseServerEvent({ payload: {}, type: "unknown.event" }),
    (error) =>
      error instanceof ProtocolSchemaError &&
      error.message === "Server event type is invalid."
  );

  const hello = {
    type: "protocol.hello",
    payload: {
      capabilities: [...DESKCUE_PROTOCOL_CAPABILITIES],
      version: DESKCUE_PROTOCOL_VERSION
    }
  };
  assert.deepEqual(parseServerEvent(hello), hello);
  assert.equal(isCompatibleProtocolMetadata(
    DESKCUE_PROTOCOL_VERSION,
    DESKCUE_PROTOCOL_CAPABILITIES
  ), true);
  assert.equal(isCompatibleProtocolMetadata(DESKCUE_PROTOCOL_VERSION, undefined), false);

  const malformedEvents = [
    {
      type: "agent.session.turn.finished",
      payload: {
        agentId: "codex",
        agentLabel: "Codex",
        agentSessionId: "codex:1",
        answer: null,
        completedAt: "2026-08-06T00:00:00.000Z",
        sourceSessionId: "1",
        status: "bogus",
        title: "Chat",
        workspaceName: null,
        workspacePath: null
      }
    },
    {
      type: "agent.session.transcript.updated",
      payload: {
        agentId: "codex",
        agentLabel: "Codex",
        agentSessionId: "codex:1",
        latestEntryId: null,
        sourceSessionId: "1",
        transcriptLength: 1,
        updatedAt: "2026-08-06T00:00:00.000Z",
        workState: "bogus"
      }
    },
    {
      type: "local.llm.chat.finished",
      payload: {
        answer: 123,
        chatId: "chat-1",
        completedAt: "2026-08-06T00:00:00.000Z",
        error: null,
        model: "model",
        runtimeId: "not-real",
        status: "bogus",
        title: "Chat"
      }
    }
  ];
  for (const malformedEvent of malformedEvents) {
    assert.throws(
      () => parseServerEvent(malformedEvent),
      (error) => error instanceof ProtocolSchemaError
    );
  }
});

test("local LLM parsers own normalization and limits", () => {
  assert.deepEqual(
    parseCreateLocalLlmChatInput({
      model: "  qwen3  ",
      runtimeId: "lm-studio",
      workspaceId: "  workspace-1  "
    }),
    {
      model: "qwen3",
      runtimeId: "lm-studio",
      workspaceId: "workspace-1"
    }
  );
  assert.deepEqual(parseUpdateLocalLlmChatAgentModeInput({ agentMode: "ask" }), {
    agentMode: "ask"
  });
  assert.deepEqual(parseUpdateLocalLlmChatPreviewInput({ port: null }), { port: null });
  assert.deepEqual(
    parseUpdateLocalLlmChatPreviewInput({
      port: 3000,
      networkMode: "deskcue-host"
    }),
    { port: 3000, networkMode: "deskcue-host" }
  );
  assert.deepEqual(parseSaveLocalLlmPendingPromptInput({ text: "  later  " }), {
    text: "later"
  });
  assert.throws(
    () => parseSendLocalLlmChatMessageInput({ text: "x".repeat(200_001) }),
    (error) =>
      error instanceof ProtocolSchemaError &&
      error.message === "Input exceeds the 200,000-character limit."
  );
});

test("LM Studio runtime parser owns model preparation input", () => {
  assert.deepEqual(parsePrepareLmStudioModelInput({ model: "  qwen/qwen3-4b  " }), {
    model: "qwen/qwen3-4b"
  });
  assert.throws(
    () => parsePrepareLmStudioModelInput({ model: " " }),
    (error) =>
      error instanceof ProtocolSchemaError &&
      error.message === "Field model must be a non-empty string."
  );
  assert.throws(
    () => parsePrepareLmStudioModelInput({ model: "x".repeat(2_049) }),
    (error) =>
      error instanceof ProtocolSchemaError &&
      error.message === "Field model exceeds the 2,048-character limit."
  );
});

test("Ollama runtime parser owns the bounded installed-model response", () => {
  assert.deepEqual(parseOllamaModelsResponse({
    models: [{ displayName: " qwen3:8b ", modelKey: " qwen3:8b " }]
  }), {
    models: [{ displayName: "qwen3:8b", modelKey: "qwen3:8b" }]
  });
  assert.throws(
    () => parseOllamaModelsResponse({ models: Array.from({ length: 257 }, () => ({
      displayName: "model",
      modelKey: "model"
    })) }),
    (error) => error instanceof ProtocolSchemaError && error.message.includes("256-item limit")
  );
  assert.throws(
    () => parseOllamaModelsResponse({ models: [{ displayName: "model", modelKey: "" }] }),
    ProtocolSchemaError
  );
});

test("notification parsers preserve partial settings and route semantics", () => {
  const settings = {
    providers: {
      telegram: { botToken: null, enabled: true },
      webhook: { headersText: "  X-DeskCue: enabled  " }
    },
    routes: [{ event: "agent.turn.finished", providers: ["telegram", "webhook"] }]
  };
  assert.deepEqual(parseUpdateNotificationSettingsInput(settings), {
    providers: {
      telegram: { botToken: "", enabled: true },
      webhook: { headersText: "X-DeskCue: enabled" }
    },
    routes: [{ event: "agent.turn.finished", providers: ["telegram", "webhook"] }]
  });
  assert.deepEqual(parseNotificationTestInput({ provider: "telegram", settings }), {
    provider: "telegram",
    settings: parseUpdateNotificationSettingsInput(settings)
  });
  assert.deepEqual(
    parseTelegramNotificationPairingResolveInput({ code: "abc_123", settings }),
    { code: "abc_123", settings: parseUpdateNotificationSettingsInput(settings) }
  );
  assert.throws(
    () => parseNotificationTestInput({ provider: "unknown" }),
    (error) =>
      error instanceof ProtocolSchemaError &&
      error.message === "Notification provider is invalid."
  );
});

test("transcript source references keep their compaction and overlap behavior", () => {
  const sourceEntryIds = Array.from({ length: 10 }, (_, index) => `turn-${index + 1}`);
  const compacted = compactAgentTranscriptSourceRefs(sourceEntryIds);

  assert.deepEqual(compacted, {
    sourceEntryCount: 10,
    sourceEntryRanges: [
      {
        end: 10,
        prefix: "turn-",
        start: 1
      }
    ]
  });
  assert.deepEqual(expandAgentTranscriptSourceRanges(compacted.sourceEntryRanges, 3), [
    "turn-1",
    "turn-2",
    "turn-3"
  ]);
  assert.equal(countAgentTranscriptSourceRefs(compacted), 10);
  assert.equal(
    doAgentTranscriptSourceRefsOverlap(compacted, {
      sourceEntryIds: ["turn-7"]
    }),
    true
  );
  assert.equal(
    doAgentTranscriptSourceRefsOverlap(compacted, {
      sourceEntryRanges: [{ end: 2, prefix: "other-", start: 1 }]
    }),
    false
  );
});

test("web push request parsers own and bound the shared wire contract", () => {
  assert.deepEqual(parseRegisterPushSubscriptionInput({
    pushClientId: " browser-1 ",
    replaceEndpoint: " https://push.example/old ",
    subscription: {
      endpoint: " https://push.example/new ",
      expirationTime: null,
      keys: { auth: " auth-key ", p256dh: " public-key " }
    }
  }), {
    pushClientId: "browser-1",
    replaceEndpoint: "https://push.example/old",
    subscription: {
      endpoint: "https://push.example/new",
      expirationTime: null,
      keys: { auth: "auth-key", p256dh: "public-key" }
    }
  });
  assert.deepEqual(parseRemovePushSubscriptionInput({ pushClientId: "browser-1" }), {
    endpoint: null,
    pushClientId: "browser-1"
  });
  assert.deepEqual(parseListPushSubscriptionsInput({}), { pushClientId: null });
  assert.equal(
    parsePushSubscriptionId("123e4567-e89b-42d3-a456-426614174000"),
    "123e4567-e89b-42d3-a456-426614174000"
  );
  assert.throws(
    () => parseRegisterPushSubscriptionInput({
      subscription: {
        endpoint: "x".repeat(4097),
        keys: { auth: "auth", p256dh: "key" }
      }
    }),
    ProtocolSchemaError
  );
  assert.throws(
    () => parseRegisterPushSubscriptionInput({
      subscription: {
        endpoint: "https://push.example",
        keys: { auth: "a".repeat(1025), p256dh: "key" }
      }
    }),
    ProtocolSchemaError
  );
  assert.throws(
    () => parseListPushSubscriptionsInput({ pushClientId: "x".repeat(129) }),
    ProtocolSchemaError
  );
  assert.throws(() => parsePushSubscriptionId("not-a-uuid"), ProtocolSchemaError);
});

test("workspace file query parsers apply bounded pagination", () => {
  assert.deepEqual(parseWorkspaceDirectoryQuery({}), {
    cursor: null,
    limit: 50,
    path: ""
  });
  assert.deepEqual(parseWorkspaceDirectoryQuery({ cursor: "n_c3Jj", limit: "100", path: "src" }), {
    cursor: "n_c3Jj",
    limit: 100,
    path: "src"
  });
  assert.deepEqual(parseWorkspaceFileQuery({ path: "src/index.ts" }), {
    path: "src/index.ts"
  });
  assert.throws(
    () => parseWorkspaceDirectoryQuery({ limit: "101" }),
    (error) => error instanceof ProtocolSchemaError && error.message.includes("between 1 and 100")
  );
  assert.throws(() => parseWorkspaceFileQuery({ path: "" }), ProtocolSchemaError);
  assert.throws(() => parseWorkspaceDirectoryQuery({ cursor: "-1" }), ProtocolSchemaError);
});
