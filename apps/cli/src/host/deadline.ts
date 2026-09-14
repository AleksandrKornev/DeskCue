export async function runWithDeadline<T>(
  operation: (remainingMs: number) => Promise<T>,
  deadline: number,
  createTimeoutError: () => Error
) {
  const remainingMs = deadline - Date.now();

  if (remainingMs <= 0) throw createTimeoutError();

  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      operation(remainingMs),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(createTimeoutError()), remainingMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
