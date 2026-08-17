import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { previewApi } from "@api/endpoint/preview/endpoints";
import { ApiHttpStatusError } from "@api/transport/errors";

import { usePreviewTicket } from "./usePreviewTicket";

vi.mock("@api/connection/config", () => ({
  buildApiUrl: (path: string) => `https://deskcue.example${path}`
}));

vi.mock("@api/endpoint/preview/endpoints", () => ({
  previewApi: {
    issueTicket: vi.fn()
  }
}));

const issueTicket = vi.mocked(previewApi.issueTicket);

describe("usePreviewTicket", () => {
  beforeEach(() => {
    issueTicket.mockReset();
    issueTicket.mockResolvedValue({
      credentialRevision: "AAAAAAAAAAAAAAAA",
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
      previewUrl: "/api/preview/sessions/session-1/"
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates an owner-scoped proxy URL only while Preview is open", async () => {
    const session = {
      id: "session-1",
      preview: { active: true, networkMode: "device-direct", port: 5173 }
    } as never;
    const { result, rerender } = renderHook(
      ({ enabled }) => usePreviewTicket(session, enabled),
      { initialProps: { enabled: false } }
    );

    expect(issueTicket).not.toHaveBeenCalled();
    rerender({ enabled: true });

    await waitFor(() => expect(result.current.url).toBe(
      "https://deskcue.example/api/preview/sessions/session-1/"
    ));
    expect(result.current.documentRevision).toBe(0);
    expect(issueTicket).toHaveBeenCalledWith(
      { kind: "session", ownerId: "session-1" },
      expect.any(AbortSignal)
    );

    rerender({ enabled: false });
    expect(result.current.url).toBeNull();
  });

  it("does not request a ticket until preview is configured", () => {
    const session = {
      id: "session-1",
      preview: { active: false, networkMode: "device-direct", port: null }
    } as never;

    const { result } = renderHook(() => usePreviewTicket(session, true));

    expect(issueTicket).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ error: "", loading: false, url: null });
  });

  it("keeps the stable URL visible and advances config revision only after a routing ticket succeeds", async () => {
    const firstTicket = {
      credentialRevision: "AAAAAAAAAAAAAAAA",
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
      previewUrl: "/api/preview/sessions/session-1/"
    };
    let resolveSecond!: (ticket: typeof firstTicket) => void;
    issueTicket
      .mockResolvedValueOnce(firstTicket)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));
    const { result, rerender } = renderHook(
      ({ networkMode }: { networkMode: "device-direct" | "deskcue-host" }) => usePreviewTicket({
        id: "session-1",
        preview: { active: true, networkMode, port: 5173 }
      } as never, true),
      { initialProps: { networkMode: "device-direct" as "device-direct" | "deskcue-host" } }
    );

    await waitFor(() => expect(result.current.url).toBe(
      "https://deskcue.example/api/preview/sessions/session-1/"
    ));
    expect(result.current.documentRevision).toBe(0);
    rerender({ networkMode: "deskcue-host" });

    expect(result.current.url).toBe("https://deskcue.example/api/preview/sessions/session-1/");
    expect(result.current.documentRevision).toBe(0);
    await waitFor(() => expect(issueTicket).toHaveBeenCalledTimes(2));
    resolveSecond({ ...firstTicket });
    await waitFor(() => expect(result.current.documentRevision).toBe(1));
    expect(result.current.url).toBe("https://deskcue.example/api/preview/sessions/session-1/");
  });

  it("advances config revision once after a port ticket succeeds", async () => {
    const stableTicket = {
      credentialRevision: "AAAAAAAAAAAAAAAA",
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
      previewUrl: "/api/preview/sessions/session-1/"
    };
    let resolveSecond!: (ticket: typeof stableTicket) => void;
    issueTicket
      .mockResolvedValueOnce(stableTicket)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));
    const { result, rerender } = renderHook(
      ({ port }: { port: number }) => usePreviewTicket({
        id: "session-1",
        preview: { active: true, networkMode: "device-direct", port }
      } as never, true),
      { initialProps: { port: 5173 } }
    );

    await waitFor(() => expect(result.current.url).not.toBeNull());
    rerender({ port: 3000 });
    await waitFor(() => expect(issueTicket).toHaveBeenCalledTimes(2));
    expect(result.current.documentRevision).toBe(0);

    resolveSecond({ ...stableTicket });
    await waitFor(() => expect(result.current.documentRevision).toBe(1));
    expect(result.current.url).toBe("https://deskcue.example/api/preview/sessions/session-1/");
  });

  it("refreshes credentials once at the ticket margin without clearing the visible URL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T00:00:00.000Z"));
    issueTicket
      .mockResolvedValueOnce({
        credentialRevision: "AAAAAAAAAAAAAAAA",
        expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
        previewUrl: "/api/preview/sessions/session-1/"
      })
      .mockResolvedValueOnce({
        credentialRevision: "AAAAAAAAAAAAAAAA",
        expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
        previewUrl: "/api/preview/sessions/session-1/"
      });
    const session = {
      id: "session-1",
      preview: { active: true, networkMode: "device-direct", port: 5173 }
    } as never;
    const { result } = renderHook(() => usePreviewTicket(session, true));

    await act(async () => Promise.resolve());
    expect(issueTicket).toHaveBeenCalledTimes(1);
    expect(result.current.url).toBe("https://deskcue.example/api/preview/sessions/session-1/");
    expect(result.current.documentRevision).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(269_999);
    });
    expect(issueTicket).toHaveBeenCalledTimes(1);
    expect(result.current.documentRevision).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(issueTicket).toHaveBeenCalledTimes(2);
    expect(result.current.url).toBe("https://deskcue.example/api/preview/sessions/session-1/");
    expect(result.current.documentRevision).toBe(0);
  });

  it("refreshes after reconnect and advances once for a new daemon credential generation", async () => {
    const ticket = {
      credentialRevision: "AAAAAAAAAAAAAAAA",
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
      previewUrl: "/api/preview/sessions/session-1/"
    };
    issueTicket
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce({ ...ticket, credentialRevision: "BBBBBBBBBBBBBBBB" })
      .mockResolvedValueOnce({ ...ticket, credentialRevision: "BBBBBBBBBBBBBBBB" });
    const session = {
      id: "session-1",
      preview: { active: true, networkMode: "device-direct", port: 5173 }
    } as never;
    const { result, rerender } = renderHook(
      ({ status }: { status: "live" | "reconnecting" }) =>
        usePreviewTicket(session, true, status),
      { initialProps: { status: "live" as "live" | "reconnecting" } }
    );

    await waitFor(() => expect(result.current.url).not.toBeNull());
    expect(result.current.documentRevision).toBe(0);

    rerender({ status: "reconnecting" });
    expect(issueTicket).toHaveBeenCalledTimes(1);
    rerender({ status: "live" });
    await waitFor(() => expect(result.current.documentRevision).toBe(1));
    expect(issueTicket).toHaveBeenCalledTimes(2);

    act(() => result.current.retry());
    await waitFor(() => expect(issueTicket).toHaveBeenCalledTimes(3));
    expect(result.current.documentRevision).toBe(1);
  });

  it("does not treat the initial connecting-to-live transition as a reconnect", async () => {
    const session = {
      id: "session-1",
      preview: { active: true, networkMode: "device-direct", port: 5173 }
    } as never;
    const { result, rerender } = renderHook(
      ({ status }: { status: "connecting" | "live" }) =>
        usePreviewTicket(session, true, status),
      { initialProps: { status: "connecting" as "connecting" | "live" } }
    );

    await waitFor(() => expect(result.current.url).not.toBeNull());
    expect(issueTicket).toHaveBeenCalledTimes(1);

    rerender({ status: "live" });
    await act(async () => Promise.resolve());

    expect(issueTicket).toHaveBeenCalledTimes(1);
    expect(result.current.documentRevision).toBe(0);
  });

  it("ignores a stale routing response across an A-to-B-to-A change", async () => {
    const initialTicket = {
      credentialRevision: "AAAAAAAAAAAAAAAA",
      expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
      previewUrl: "/api/preview/sessions/session-1/"
    };
    let resolveB!: (ticket: typeof initialTicket) => void;
    let resolveFinalA!: (ticket: typeof initialTicket) => void;
    issueTicket
      .mockResolvedValueOnce(initialTicket)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveB = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFinalA = resolve;
      }));
    const { result, rerender } = renderHook(
      ({ networkMode }: { networkMode: "device-direct" | "deskcue-host" }) =>
        usePreviewTicket({
          id: "session-1",
          preview: { active: true, networkMode, port: 5173 }
        } as never, true),
      { initialProps: { networkMode: "device-direct" as "device-direct" | "deskcue-host" } }
    );

    await waitFor(() => expect(result.current.url).not.toBeNull());
    rerender({ networkMode: "deskcue-host" });
    await waitFor(() => expect(issueTicket).toHaveBeenCalledTimes(2));
    rerender({ networkMode: "device-direct" });
    await waitFor(() => expect(issueTicket).toHaveBeenCalledTimes(3));

    resolveB({ ...initialTicket, credentialRevision: "BBBBBBBBBBBBBBBB" });
    await act(async () => Promise.resolve());
    expect(result.current.documentRevision).toBe(0);

    resolveFinalA(initialTicket);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.documentRevision).toBe(0);
    expect(result.current.url).toBe("https://deskcue.example/api/preview/sessions/session-1/");
  });

  it("keeps a live frame visible and retries after a transient credential refresh failure", async () => {
    vi.useFakeTimers();
    issueTicket
      .mockResolvedValueOnce({
        credentialRevision: "AAAAAAAAAAAAAAAA",
        expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
        previewUrl: "/api/preview/sessions/session-1/"
      })
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValueOnce({
        credentialRevision: "AAAAAAAAAAAAAAAA",
        expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
        previewUrl: "/api/preview/sessions/session-1/"
      });
    const session = {
      id: "session-1",
      preview: { active: true, networkMode: "device-direct", port: 5173 }
    } as never;
    const { result } = renderHook(() => usePreviewTicket(session, true));

    await act(async () => Promise.resolve());
    expect(result.current.url).not.toBeNull();

    act(() => result.current.retry());
    await act(async () => Promise.resolve());
    expect(issueTicket).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({
      documentRevision: 0,
      error: "",
      loading: false,
      url: "https://deskcue.example/api/preview/sessions/session-1/"
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(issueTicket).toHaveBeenCalledTimes(3);
    expect(result.current.documentRevision).toBe(0);
  });

  it("bounds automatic retries for an unavailable configured preview", async () => {
    vi.useFakeTimers();
    issueTicket.mockRejectedValue(new ApiHttpStatusError(
      409,
      "The local preview server is unavailable."
    ));
    const session = {
      id: "session-1",
      preview: { active: true, networkMode: "device-direct", port: 9300 }
    } as never;
    const { result } = renderHook(() => usePreviewTicket(session, true));

    await act(async () => Promise.resolve());
    expect(result.current).toMatchObject({
      error: "The local preview server is unavailable.",
      loading: false,
      url: null
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(issueTicket).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({
      error: "The local preview server is unavailable.",
      loading: false,
      url: null
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(issueTicket).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(issueTicket).toHaveBeenCalledTimes(3);

    act(() => result.current.retry());
    await act(async () => Promise.resolve());
    expect(issueTicket).toHaveBeenCalledTimes(4);
  });

  it("does not present an old frame as live after switching to an unavailable port", async () => {
    issueTicket
      .mockResolvedValueOnce({
        credentialRevision: "AAAAAAAAAAAAAAAA",
        expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
        previewUrl: "/api/preview/sessions/session-1/"
      })
      .mockRejectedValueOnce(new Error("preview unavailable"));
    const { result, rerender } = renderHook(
      ({ port }: { port: number }) => usePreviewTicket({
        id: "session-1",
        preview: { active: true, networkMode: "device-direct", port }
      } as never, true),
      { initialProps: { port: 9300 } }
    );

    await waitFor(() => expect(result.current.url).not.toBeNull());
    rerender({ port: 9399 });
    await waitFor(() => expect(result.current.error).toBe("preview unavailable"));

    expect(result.current).toMatchObject({
      loading: false,
      url: null
    });
  });

  it("does not treat a partially hydrated preview as active", () => {
    const session = {
      id: "session-1",
      preview: { active: true, networkMode: "device-direct" }
    } as never;

    const { result } = renderHook(() => usePreviewTicket(session, true));

    expect(issueTicket).not.toHaveBeenCalled();
    expect(result.current.url).toBeNull();
  });
});
