import assert from "node:assert/strict";
import test from "node:test";

import { HttpLocalLlmAgentTransport } from "./localLlmAgentTransport.ts";
import { HttpLocalLlmChatTransport } from "./localLlmProviderTransport.ts";
import { HttpLocalLlmRuntimeAdapterRegistry } from "./transport/localLlmRuntimeAdapterRegistry.ts";

test("one Ollama adapter preserves plain-chat reasoning and agent tool replay wire shapes", async () => {
  const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
  const registry = new HttpLocalLlmRuntimeAdapterRegistry({
    fetch: async (url, init) => {
      requests.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        url: String(url)
      });
      return new Response(
        '{"message":{"thinking":"Check first.","content":"Done"},"done":true}\n'
      );
    },
    ollamaEndpoint: "http://ollama.test/"
  });
  const chatTransport = new HttpLocalLlmChatTransport(registry);
  const agentTransport = new HttpLocalLlmAgentTransport(registry);
  const chatText: string[] = [];
  const chatReasoning: string[] = [];
  const agentEvents: unknown[] = [];

  await chatTransport.generate({
    messages: [{ role: "user", text: "Hello" }],
    model: "local-model",
    onDelta: (text) => chatText.push(text),
    onReasoningDelta: (text) => chatReasoning.push(text),
    runtimeId: "ollama",
    signal: new AbortController().signal,
    systemPrompt: "Be concise."
  });
  await agentTransport.generate({
    messages: [
      { role: "user", content: "Read it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{
          arguments: { path: "old.ts" },
          argumentsText: '{"path":"old.ts"}',
          id: "call-old",
          name: "read_workspace_file"
        }]
      },
      { role: "tool", content: "old file", toolCallId: "call-old" }
    ],
    model: "local-model",
    onEvent: (event) => agentEvents.push(event),
    runtimeId: "ollama",
    tools: [{ type: "function", function: { name: "read_workspace_file", parameters: {} } }]
  });

  assert.deepEqual(requests.map(({ url }) => url), [
    "http://ollama.test/api/chat",
    "http://ollama.test/api/chat"
  ]);
  assert.deepEqual(requests[0]?.body.messages, [
    { role: "system", content: "Be concise." },
    { role: "user", content: "Hello" }
  ]);
  assert.equal("tools" in (requests[0]?.body ?? {}), false);
  assert.deepEqual(requests[1]?.body.messages, [
    { role: "user", content: "Read it" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "read_workspace_file", arguments: { path: "old.ts" } } }]
    },
    { role: "tool", content: "old file" }
  ]);
  assert.deepEqual(chatReasoning, ["Check first."]);
  assert.deepEqual(chatText, ["Done"]);
  assert.deepEqual(agentEvents, [
    { type: "assistant_reasoning_delta", text: "Check first." },
    { type: "assistant_text_delta", text: "Done" }
  ]);
});

test("one LM Studio adapter keeps native response ids separate from tool history replay", async () => {
  const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
  const registry = new HttpLocalLlmRuntimeAdapterRegistry({
    fetch: async (url, init) => {
      requests.push({
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        url: String(url)
      });
      return String(url).endsWith("/api/v1/chat")
        ? new Response([
          "event: message.delta\n",
          'data: {"content":"Native"}\n\n',
          "event: chat.end\n",
          'data: {"result":{"response_id":"resp-next"}}\n\n'
        ].join(""))
        : new Response([
          'data: {"choices":[{"delta":{"content":"Replay"}}]}\n\n',
          "data: [DONE]\n\n"
        ].join(""));
    },
    lmStudioEndpoint: async () => "http://lm.test/"
  });
  const chatTransport = new HttpLocalLlmChatTransport(registry);
  const agentTransport = new HttpLocalLlmAgentTransport(registry);
  const chatText: string[] = [];

  const nativeResult = await chatTransport.generate({
    messages: [{ role: "user", text: "Continue" }],
    model: "local-model",
    onDelta: (text) => chatText.push(text),
    previousResponseId: "resp-old",
    runtimeId: "lm-studio",
    signal: new AbortController().signal,
    useNativeSession: true
  });
  await agentTransport.generate({
    messages: [
      { role: "user", content: "Read it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{
          arguments: { path: "old.ts" },
          argumentsText: '{"path":"old.ts"}',
          id: "call-old",
          name: "read_workspace_file"
        }]
      },
      { role: "tool", content: "old file", toolCallId: "call-old" }
    ],
    model: "local-model",
    onEvent: () => undefined,
    runtimeId: "lm-studio",
    tools: [{ type: "function", function: { name: "read_workspace_file", parameters: {} } }]
  });

  assert.deepEqual(nativeResult, { responseId: "resp-next" });
  assert.deepEqual(chatText, ["Native"]);
  assert.deepEqual(requests.map(({ url }) => url), [
    "http://lm.test/api/v1/chat",
    "http://lm.test/v1/chat/completions"
  ]);
  assert.equal(requests[0]?.body.previous_response_id, "resp-old");
  assert.deepEqual(requests[1]?.body.messages, [
    { role: "user", content: "Read it" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "call-old",
        type: "function",
        function: { name: "read_workspace_file", arguments: '{"path":"old.ts"}' }
      }]
    },
    { role: "tool", content: "old file", tool_call_id: "call-old" }
  ]);
});
