import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpLocalLlmAgentTransport,
  HttpLocalLlmToolCapabilityProbe,
  LmStudioToolCallAccumulator,
  MAX_LM_STUDIO_TOOL_ARGUMENT_BYTES,
  parseOllamaToolCalls
} from "./localLlmAgentTransport.ts";

test("Ollama tool calls keep complete structured arguments", () => {
  assert.deepEqual(parseOllamaToolCalls({
    message: {
      tool_calls: [{
        id: "call-1",
        function: { name: "read_workspace_file", arguments: { path: "src/index.ts", max_bytes: 100 } }
      }]
    }
  }), [{
    id: "call-1",
    name: "read_workspace_file",
    argumentsText: '{"path":"src/index.ts","max_bytes":100}',
    arguments: { path: "src/index.ts", max_bytes: 100 }
  }]);
});

test("Ollama agent replay keeps tool arguments in Ollama's native object shape", async () => {
  let requestBody = "";
  const transport = new HttpLocalLlmAgentTransport({
    fetch: async (_url, init) => {
      requestBody = String(init?.body);
      return new Response('{"done":true,"message":{"content":"Done"}}\n');
    }
  });
  await transport.generate({
    endpoint: "http://ollama.test",
    runtimeId: "ollama",
    model: "tool-model",
    messages: [
      { role: "user", content: "Read it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_old", name: "read_workspace_file", argumentsText: '{"path":"old.ts"}', arguments: { path: "old.ts" } }]
      },
      { role: "tool", toolCallId: "call_old", content: "old file" }
    ],
    tools: [{ type: "function", function: { name: "read_workspace_file", parameters: {} } }],
    onEvent: () => undefined
  });
  const request = JSON.parse(requestBody) as { messages: unknown[] };
  assert.deepEqual(request.messages, [
    { role: "user", content: "Read it" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "read_workspace_file", arguments: { path: "old.ts" } } }]
    },
    { role: "tool", content: "old file" }
  ]);
});

test("Ollama agent transport forwards explicitly exposed reasoning separately from answer text", async () => {
  const transport = new HttpLocalLlmAgentTransport({
    fetch: async () => new Response(
      '{"message":{"thinking":"Inspect the workspace first.","content":"Done"},"done":true}\n'
    )
  });
  const events: unknown[] = [];
  await transport.generate({
    endpoint: "http://ollama.test",
    runtimeId: "ollama",
    model: "thinking-model",
    messages: [{ role: "user", content: "Inspect it" }],
    tools: [],
    onEvent: (event) => events.push(event)
  });

  assert.deepEqual(events, [
    { type: "assistant_reasoning_delta", text: "Inspect the workspace first." },
    { type: "assistant_text_delta", text: "Done" }
  ]);
});

test("aborting a quiet local runtime stream cancels its reader and rejects promptly", async () => {
  let streamCanceled = false;
  const transport = new HttpLocalLlmAgentTransport({
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      cancel() {
        streamCanceled = true;
      }
    }))
  });
  const controller = new AbortController();
  const generation = transport.generate({
    endpoint: "http://ollama.test",
    runtimeId: "ollama",
    model: "quiet-model",
    messages: [{ role: "user", content: "Wait" }],
    tools: [],
    signal: controller.signal,
    onEvent: () => undefined
  });

  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(generation, (error: unknown) =>
    error instanceof Error && error.name === "AbortError"
  );
  assert.equal(streamCanceled, true);
});

test("LM Studio OpenAI SSE fragments become text deltas and one complete tool call", () => {
  const accumulator = new LmStudioToolCallAccumulator();
  assert.deepEqual(accumulator.push({
    choices: [{ delta: { content: "I will inspect it. ", tool_calls: [{
      index: 0,
      id: "call_42",
      function: { name: "read_workspace_file", arguments: '{"path":"src/' }
    }] } }]
  }), [{ type: "assistant_text_delta", text: "I will inspect it. " }]);
  assert.deepEqual(accumulator.push({
    choices: [{ delta: { tool_calls: [{
      index: 0,
      function: { arguments: 'index.ts"}' }
    }] } }]
  }), []);
  assert.deepEqual(accumulator.complete(), [{
    id: "call_42",
    name: "read_workspace_file",
    argumentsText: '{"path":"src/index.ts"}',
    arguments: { path: "src/index.ts" }
  }]);
});

test("LM Studio tool-call accumulator bounds arguments across small fragments", () => {
  const accumulator = new LmStudioToolCallAccumulator();
  const fragment = "x".repeat(64 * 1024);
  for (let bytes = 0; bytes < MAX_LM_STUDIO_TOOL_ARGUMENT_BYTES; bytes += fragment.length) {
    accumulator.push({
      choices: [{ delta: { tool_calls: [{
        index: 0,
        function: { arguments: fragment, name: "read_workspace_file" }
      }] } }]
    });
  }

  assert.throws(() => accumulator.push({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "x" } }] } }]
  }), /tool arguments exceed/i);
});

test("local runtime error responses are bounded before surfacing", async () => {
  const transport = new HttpLocalLlmAgentTransport({
    fetch: async () => new Response("x".repeat(128 * 1024), { status: 502 })
  });

  await assert.rejects(transport.generate({
    endpoint: "http://lm.test",
    runtimeId: "lm-studio",
    model: "local-model",
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    signal: new AbortController().signal,
    onEvent: () => undefined
  }), (error: unknown) => (
    error instanceof Error &&
    error.message.includes("[Response body truncated]") &&
    Buffer.byteLength(error.message, "utf8") < 66 * 1024
  ));
});

test("LM Studio history-replay transport sends replayable assistant tool calls and tool results", async () => {
  let requestBody = "";
  const transport = new HttpLocalLlmAgentTransport({
    fetch: async (_url, init) => {
      requestBody = String(init?.body);
      return new Response([
        'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_workspace_file","arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\n\n',
        "data: [DONE]\n\n"
      ].join(""));
    }
  });
  const events: unknown[] = [];
  await transport.generate({
    endpoint: "http://lm.test",
    runtimeId: "lm-studio",
    model: "local-model",
    messages: [
      { role: "user", content: "Read it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_old", name: "read_workspace_file", argumentsText: '{"path":"old.ts"}', arguments: { path: "old.ts" } }]
      },
      { role: "tool", toolCallId: "call_old", content: "old file" }
    ],
    tools: [{ type: "function", function: { name: "read_workspace_file", parameters: {} } }],
    onEvent: (event) => events.push(event)
  });
  const request = JSON.parse(requestBody) as Record<string, unknown>;
  assert.equal(request.tool_choice, "auto");
  assert.deepEqual(request.messages, [
    { role: "user", content: "Read it" },
    { role: "assistant", content: "", tool_calls: [{ id: "call_old", type: "function", function: { name: "read_workspace_file", arguments: '{"path":"old.ts"}' } }] },
    { role: "tool", tool_call_id: "call_old", content: "old file" }
  ]);
  assert.deepEqual(events, [
    { type: "assistant_text_delta", text: "Done" },
    { type: "tool_call", toolCall: { id: "call_1", name: "read_workspace_file", argumentsText: '{"path":"a.ts"}', arguments: { path: "a.ts" } } }
  ]);
});

test("capability probe only enables tools from explicit runtime metadata", async () => {
  const probe = new HttpLocalLlmToolCapabilityProbe({
    fetch: async (url) => new Response(String(url).includes("ollama")
      ? JSON.stringify({ capabilities: ["completion", "tools"] })
      : JSON.stringify({ id: "plain-model" }))
  });
  const ollama = await probe.probe({ runtimeId: "ollama", endpoint: "http://ollama.test", model: "tool-model" });
  const lmStudio = await probe.probe({ runtimeId: "lm-studio", endpoint: "http://lm.test", model: "plain-model" });
  assert.equal(ollama.modelSupportsToolCalls, true);
  assert.equal(ollama.source, "ollama_model_metadata");
  assert.equal(lmStudio.modelSupportsToolCalls, false);
  assert.equal(lmStudio.source, "runtime_metadata_unavailable");
});
