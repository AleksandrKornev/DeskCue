import { createCodexTranscriptEntry } from "./codexTranscriptEntryFactory.ts";
import { buildGeneratedImageToolResultParts } from "./codexTranscriptGeneratedImages.ts";
import { buildPatchApplyParts, buildPatchApplySummary } from "../codexTranscriptPatch.ts";
import { isRecord } from "../codexTranscriptShared.ts";
import {
  buildToolCallSummary,
  inferToolNameFromOutput,
  normalizeMcpToolResult,
  normalizeToolOutput,
  redactTranscriptToolPreview,
  redactTranscriptToolText
} from "./codexTranscriptTools.ts";

function readToolCallArguments(payload: Record<string, unknown>) {
  const value = payload.arguments ?? payload.input;

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return redactTranscriptToolPreview(value.trim(), 320);
}

function readPatchEventPayload(
  itemType: string,
  payload: Record<string, unknown> | null
) {
  if (itemType !== "event_msg" || !payload) return null;
  if (payload.type === "patch_apply_end") return payload;
  if (payload.type !== "item_completed") return null;

  const item = isRecord(payload.item) ? payload.item : null;

  if (item?.type !== "FileChange") return null;

  return {
    ...item,
    success: item.status !== "failed"
  };
}

export function toCodexToolTranscriptEntry(
  itemType: string,
  payload: Record<string, unknown> | null,
  sessionId: string,
  index: number,
  timestamp: string
) {
  const patchPayload = readPatchEventPayload(itemType, payload);

  if (patchPayload) {
    const parts = buildPatchApplyParts(patchPayload);
    const summary = buildPatchApplySummary(patchPayload, parts);

    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "tool",
      summary,
      null,
      parts
    );
  }

  if (
    itemType === "response_item" &&
    (payload?.type === "function_call" || payload?.type === "custom_tool_call")
  ) {
    const toolName = typeof payload.name === "string" ? payload.name : "tool";
    const namespace = typeof payload.namespace === "string" ? payload.namespace : null;
    const argumentsText = readToolCallArguments(payload);

    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "tool",
      buildToolCallSummary(toolName, namespace, argumentsText),
      null,
      [
        {
          type: "tool_call",
          toolName,
          namespace,
          argumentsText
        }
      ]
    );
  }

  if (
    itemType === "response_item" &&
    (payload?.type === "function_call_output" || payload?.type === "custom_tool_call_output")
  ) {
    const callId = typeof payload.call_id === "string" ? payload.call_id : null;
    const generatedImageParts = buildGeneratedImageToolResultParts(
      payload.output,
      sessionId,
      callId
    );
    const toolName = generatedImageParts.length > 0
      ? "imagegen"
      : inferToolNameFromOutput(payload.output);
    const outputText = redactTranscriptToolText(normalizeToolOutput(payload.output));

    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "tool",
      generatedImageParts.length > 0
        ? "Generated image"
        : toolName
          ? `Completed ${toolName}`
          : "Tool completed",
      null,
      generatedImageParts.length > 0
        ? [
            {
              type: "status",
              label: "Generated image",
              detail: callId
            },
            ...generatedImageParts,
            ...(outputText
              ? [
                  {
                    type: "tool_result" as const,
                    toolName,
                    status: "completed" as const,
                    text: outputText
                  }
                ]
              : [])
          ]
        : outputText
        ? [
            {
              type: "tool_result",
              toolName,
              status: "completed",
              text: outputText
            }
          ]
        : [
            {
              type: "status",
              label: toolName ? `Completed ${toolName}` : "Tool completed",
              detail: null
            }
          ]
    );
  }

  if (itemType === "response_item" && payload?.type === "web_search_call") {
    const action = isRecord(payload.action) ? payload.action : null;
    const query = typeof action?.query === "string" ? action.query.trim() : "";

    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "tool",
      query ? `Web search: ${query}` : "Web search",
      null,
      [
        {
          type: "tool_call",
          toolName: "web_search",
          namespace: null,
          argumentsText: query ? redactTranscriptToolText(query) : null
        }
      ]
    );
  }

  if (itemType === "event_msg" && payload?.type === "web_search_end") {
    const query = typeof payload.query === "string" ? payload.query.trim() : "";

    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "tool",
      query ? `Finished web search: ${query}` : "Finished web search",
      null,
      [
        {
          type: "tool_result",
          toolName: "web_search",
          status: "completed",
          text: query ? redactTranscriptToolText(query) : "Search finished"
        }
      ]
    );
  }

  if (itemType === "event_msg" && payload?.type === "mcp_tool_call_end") {
    const invocation = isRecord(payload.invocation) ? payload.invocation : null;
    const server = typeof invocation?.server === "string" ? invocation.server : null;
    const tool = typeof invocation?.tool === "string" ? invocation.tool : null;
    const resultText = redactTranscriptToolText(normalizeMcpToolResult(payload.result));

    return createCodexTranscriptEntry(
      sessionId,
      index,
      timestamp,
      "tool",
      tool ? `Completed ${tool}` : "Tool completed",
      null,
      [
        {
          type: "tool_result",
          toolName: tool,
          status: "completed",
          text: resultText || (server && tool ? `${server}.${tool}` : "Tool completed")
        }
      ]
    );
  }

  return undefined;
}
