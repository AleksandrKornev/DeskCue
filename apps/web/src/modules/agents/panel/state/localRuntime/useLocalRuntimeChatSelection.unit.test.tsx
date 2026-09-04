import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LocalLlmChatSummary } from "@deskcue/protocol";

import { buildLocalRuntimeTabs, filterLocalRuntimeChats } from "./helpers";
import { useLocalRuntimeChatSelection } from "./useLocalRuntimeChatSelection";

function chat(
  id: string,
  runtimeId: LocalLlmChatSummary["runtimeId"],
  title: string
): LocalLlmChatSummary {
  return {
    agentMode: "ask",
    createdAt: "2026-08-06T00:00:00.000Z",
    generationError: null,
    generationState: "idle",
    id,
    model: runtimeId === "ollama" ? "qwen" : "coder",
    runtimeId,
    title,
    toolCapability: null,
    updatedAt: "2026-08-06T00:00:00.000Z",
    workspace: null
  };
}

describe("local runtime chat selection", () => {
  const chats = [
    chat("ollama-1", "ollama", "Qwen plan"),
    chat("studio-1", "lm-studio", "Code review")
  ];

  it("filters by source, runtime, title, model and friendly runtime label", () => {
    expect(filterLocalRuntimeChats({
      chats,
      query: "",
      runtimeId: null,
      selectedSourceId: "codex"
    })).toEqual([]);
    expect(filterLocalRuntimeChats({
      chats,
      query: "lm studio",
      runtimeId: null,
      selectedSourceId: "all"
    })).toEqual([chats[1]]);
    expect(filterLocalRuntimeChats({
      chats,
      query: "",
      runtimeId: "ollama",
      selectedSourceId: "all"
    })).toEqual([chats[0]]);
  });

  it("builds stable runtime tabs with their chat counts", () => {
    expect(buildLocalRuntimeTabs(chats)).toEqual([
      { id: "ollama", label: "Ollama", sessionCount: 1 },
      { id: "lm-studio", label: "LM Studio", sessionCount: 1 }
    ]);
  });

  it("scopes runtime tab counts to the current search query", () => {
    const { result, rerender } = renderHook(
      ({ query }) => useLocalRuntimeChatSelection({
        chats,
        onSelectSource: vi.fn(),
        query,
        selectedSourceId: "all"
      }),
      { initialProps: { query: "" } }
    );

    expect(result.current.queryMatchedChatsCount).toBe(2);
    rerender({ query: "qwen" });

    expect(result.current.queryMatchedChatsCount).toBe(1);
    expect(result.current.runtimeTabs).toEqual([
      { id: "ollama", label: "Ollama", sessionCount: 1 },
      { id: "lm-studio", label: "LM Studio", sessionCount: 0 }
    ]);
  });

  it("switches to all sources for a local runtime and clears local selection", () => {
    const onSelectSource = vi.fn();
    const { result } = renderHook(() => useLocalRuntimeChatSelection({
      chats,
      onSelectSource,
      query: "",
      selectedSourceId: "codex"
    }));

    act(() => {
      result.current.openChat(chats[0]);
      result.current.selectRuntime("ollama");
    });

    expect(result.current.selectedChat).toBeNull();
    expect(result.current.selectedRuntime).toBe("ollama");
    expect(onSelectSource).toHaveBeenCalledWith("all");

    act(() => result.current.selectSource("claude-code"));
    expect(result.current.selectedRuntime).toBeNull();
    expect(onSelectSource).toHaveBeenLastCalledWith("claude-code");
  });

  it("keeps the selected preview attached to the latest chat summary", () => {
    const onSelectSource = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentChats }) => useLocalRuntimeChatSelection({
        chats: currentChats,
        onSelectSource,
        query: "",
        selectedSourceId: "all"
      }),
      { initialProps: { currentChats: chats } }
    );

    act(() => result.current.openChat(chats[0]));
    const updatedChat = {
      ...chats[0],
      generationState: "running" as const,
      updatedAt: "2026-08-06T00:01:00.000Z"
    };

    rerender({ currentChats: [updatedChat, chats[1]] });

    expect(result.current.selectedChat).toBe(updatedChat);
  });

  it("keeps the selected runtime explicit when a search has no matching chats", () => {
    const { result, rerender } = renderHook(
      ({ query }) => useLocalRuntimeChatSelection({
        chats,
        onSelectSource: vi.fn(),
        query,
        selectedSourceId: "all"
      }),
      { initialProps: { query: "" } }
    );

    act(() => result.current.selectRuntime("ollama"));
    rerender({ query: "code review" });

    expect(result.current.selectedRuntime).toBe("ollama");
    expect(result.current.filteredChats).toEqual([]);
  });
});
