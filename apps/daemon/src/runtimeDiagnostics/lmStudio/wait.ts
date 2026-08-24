type WaitTimerRef = {
  current: ReturnType<typeof setTimeout> | null;
};

function createWaitAbortHandler(
  timerRef: WaitTimerRef,
  signal: AbortSignal | undefined,
  reject: (reason?: unknown) => void
) {
  return () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    reject(signal?.reason ?? new Error("LM Studio runtime operation was aborted."));
  };
}

export async function waitForLmStudio(milliseconds: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timerRef: WaitTimerRef = { current: null };
    const onAbort = createWaitAbortHandler(timerRef, signal, reject);

    timerRef.current = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
