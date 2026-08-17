import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import test from "node:test";

import { createControllerClose } from "./daemonServerController.ts";
import {
  createProcessErrorHandlers,
  createShutdownHandler,
  registerHttpServerErrorHandler,
  registerProcessErrorHandlers,
  registerShutdownHandlers
} from "./shutdown.ts";

test("HTTP server runtime errors enter the shared graceful shutdown", async () => {
  const server = Object.assign(new EventEmitter(), {
    close: () => {},
    closeIdleConnections: () => {}
  }) as unknown as Server;
  const calls: Array<{ exitCode: number | undefined; reason: string }> = [];
  const dispose = registerHttpServerErrorHandler(server, async (reason, exitCode) => {
    calls.push({ exitCode, reason });
  });

  server.emit("error", Object.assign(new Error("socket failed"), { code: "EIO" }));
  await Promise.resolve();

  assert.deepEqual(calls, [{ exitCode: 1, reason: "httpServerError" }]);
  dispose();
  assert.equal(server.listenerCount("error"), 0);
});

function fakeServer(input: {
  close: (callback: (error?: Error) => void) => void;
  closeIdleConnections: () => void;
}): Server {
  return {
    close: input.close,
    closeIdleConnections: input.closeIdleConnections
  } as unknown as Server;
}

test("shutdown awaits Cloud ingress before HTTP, realtime, and application drains", async () => {
  const calls: string[] = [];
  const exitCodes: number[] = [];
  let releaseIngress!: () => void;
  const ingressClosed = new Promise<void>((resolve) => {
    releaseIngress = resolve;
  });

  const shutdown = createShutdownHandler({
    closeApplication: async () => {
      await Promise.resolve();
      calls.push("application.close");
    },
    closeIngress: async () => {
      calls.push("ingress.close.start");
      await ingressClosed;
      calls.push("ingress.close.finish");
    },
    closeRealtime: (callback) => {
      calls.push("realtime.close");
      callback();
    },
    exitProcess: (exitCode) => {
      exitCodes.push(exitCode);
    },
    server: fakeServer({
      close: (callback) => {
        calls.push("server.close");
        callback();
      },
      closeIdleConnections: () => {
        calls.push("server.closeIdleConnections");
      }
    }),
    setShutdownTimeout: () => ({
      unref: () => {}
    })
  });

  const shutdownPromise = shutdown("SIGTERM");
  await Promise.resolve();
  assert.deepEqual(calls, ["ingress.close.start"]);
  releaseIngress();
  await shutdownPromise;

  assert.deepEqual(calls, [
    "ingress.close.start",
    "ingress.close.finish",
    "server.close",
    "server.closeIdleConnections",
    "realtime.close",
    "application.close"
  ]);
  assert.deepEqual(exitCodes, [0]);
});

test("shutdown still drains transports and application when Cloud ingress close fails", async () => {
  const calls: string[] = [];
  const exitCodes: number[] = [];
  const shutdown = createShutdownHandler({
    closeApplication: () => {
      calls.push("application.close");
    },
    closeIngress: () => {
      calls.push("ingress.close");
      throw new Error("ingress close failed");
    },
    closeRealtime: (callback) => {
      calls.push("realtime.close");
      callback();
    },
    exitProcess: (exitCode) => exitCodes.push(exitCode),
    server: fakeServer({
      close: (callback) => {
        calls.push("server.close");
        callback();
      },
      closeIdleConnections: () => {}
    }),
    setShutdownTimeout: () => ({ unref: () => {} })
  });

  await shutdown("SIGTERM");

  assert.deepEqual(calls, [
    "ingress.close",
    "server.close",
    "realtime.close",
    "application.close"
  ]);
  assert.deepEqual(exitCodes, [1]);
});

test("shutdown flushes the final log queue after resources and before exit", async () => {
  const calls: string[] = [];
  const shutdown = createShutdownHandler({
    closeApplication: () => {
      calls.push("application.close");
    },
    closeRealtime: (callback) => {
      calls.push("realtime.close");
      callback();
    },
    exitProcess: () => {
      calls.push("process.exit");
    },
    flushLogs: async () => {
      calls.push("logs.flush");
    },
    server: fakeServer({
      close: (callback) => {
        calls.push("server.close");
        callback();
      },
      closeIdleConnections: () => {}
    }),
    setShutdownTimeout: () => ({ unref: () => {} })
  });

  await shutdown("SIGTERM");

  assert.deepEqual(calls, [
    "server.close",
    "realtime.close",
    "application.close",
    "logs.flush",
    "process.exit"
  ]);
});

test("shutdown exits with failure when the final log drain fails", async () => {
  const exitCodes: number[] = [];
  const shutdown = createShutdownHandler({
    closeRealtime: (callback) => callback(),
    exitProcess: (exitCode) => exitCodes.push(exitCode),
    flushLogs: async () => {
      throw new Error("log drain failed");
    },
    server: fakeServer({
      close: (callback) => callback(),
      closeIdleConnections: () => {}
    }),
    setShutdownTimeout: () => ({ unref: () => {} })
  });

  await shutdown("SIGTERM");

  assert.deepEqual(exitCodes, [1]);
});

test("shutdown closes realtime and drains application when HTTP close fails", async () => {
  const exitCodes: number[] = [];
  const calls: string[] = [];

  const shutdown = createShutdownHandler({
    closeApplication: () => {
      calls.push("application.close");
    },
    closeRealtime: (callback) => {
      calls.push("realtime.close");
      callback();
    },
    exitProcess: (exitCode) => {
      exitCodes.push(exitCode);
    },
    server: fakeServer({
      close: (callback) => {
        callback(new Error("close failed"));
      },
      closeIdleConnections: () => {}
    }),
    setShutdownTimeout: () => ({
      unref: () => {}
    })
  });

  await shutdown("SIGTERM");

  assert.deepEqual(calls, ["realtime.close", "application.close"]);
  assert.deepEqual(exitCodes, [1]);
});

test("shutdown does not wait for HTTP close before terminating realtime", async () => {
  const calls: string[] = [];
  let finishHttpClose: (() => void) | null = null;
  const shutdown = createShutdownHandler({
    closeApplication: () => {
      calls.push("application.close");
    },
    closeRealtime: (callback) => {
      calls.push("realtime.close");
      finishHttpClose?.();
      callback();
    },
    exitProcess: () => {
      calls.push("process.exit");
    },
    server: fakeServer({
      close: (callback) => {
        calls.push("server.close");
        finishHttpClose = callback;
      },
      closeIdleConnections: () => {
        calls.push("server.closeIdleConnections");
      }
    }),
    setShutdownTimeout: () => ({ unref: () => {} })
  });

  await shutdown("SIGTERM");

  assert.deepEqual(calls, [
    "server.close",
    "server.closeIdleConnections",
    "realtime.close",
    "application.close",
    "process.exit"
  ]);
});

test("shutdown timeout exits with failure", async () => {
  const exitCodes: number[] = [];

  const shutdown = createShutdownHandler({
    closeRealtime: () => {},
    exitProcess: (exitCode) => {
      exitCodes.push(exitCode);
    },
    server: fakeServer({
      close: () => {},
      closeIdleConnections: () => {}
    }),
    setShutdownTimeout: (callback) => {
      callback();
      return {
        unref: () => {}
      };
    }
  });

  void shutdown("SIGINT");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(exitCodes, [1]);
});

test("hard shutdown deadline exits even when application drain never resolves", async () => {
  const exitCodes: number[] = [];
  const shutdown = createShutdownHandler({
    closeApplication: () => new Promise<void>(() => {}),
    closeRealtime: (callback) => callback(),
    exitProcess: (exitCode) => exitCodes.push(exitCode),
    server: fakeServer({
      close: (callback) => callback(),
      closeIdleConnections: () => {}
    }),
    setShutdownTimeout: (callback) => {
      callback();
      return { unref: () => {} };
    }
  });

  void shutdown("SIGTERM");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(exitCodes, [1]);
});

test("shutdown reports a failed application drain", async () => {
  const exitCodes: number[] = [];
  const shutdown = createShutdownHandler({
    closeApplication: async () => {
      throw new Error("flush failed");
    },
    closeRealtime: (callback) => callback(),
    exitProcess: (exitCode) => exitCodes.push(exitCode),
    server: fakeServer({
      close: (callback) => callback(),
      closeIdleConnections: () => {}
    }),
    setShutdownTimeout: () => ({ unref: () => {} })
  });

  await shutdown("SIGTERM");

  assert.deepEqual(exitCodes, [1]);
});

test("sequential in-process server closes restore every process listener count", async () => {
  const events = [
    "SIGINT",
    "SIGTERM",
    "uncaughtException",
    "unhandledRejection"
  ] as const;
  const baseline = Object.fromEntries(
    events.map((event) => [event, process.listenerCount(event)])
  ) as Record<(typeof events)[number], number>;
  let closeCalls = 0;

  for (let lifecycle = 0; lifecycle < 3; lifecycle += 1) {
    const shutdown = createShutdownHandler({
      closeRealtime: (callback) => callback(),
      exitProcess: () => {},
      server: fakeServer({
        close: (callback) => callback(),
        closeIdleConnections: () => {}
      }),
      setShutdownTimeout: () => ({ unref: () => {} })
    });
    const disposeShutdown = registerShutdownHandlers(shutdown);
    const disposeErrors = registerProcessErrorHandlers(shutdown);
    const close = createControllerClose(async () => {
      closeCalls += 1;
    }, () => {
      disposeShutdown();
      disposeErrors();
    });

    for (const event of events) {
      assert.equal(process.listenerCount(event), baseline[event] + 1);
    }

    await Promise.all([close(), close()]);
    await close();

    for (const event of events) {
      assert.equal(process.listenerCount(event), baseline[event]);
    }
  }

  assert.equal(closeCalls, 3);
});

test("process handler disposers are independently idempotent", () => {
  const sigintBaseline = process.listenerCount("SIGINT");
  const rejectionBaseline = process.listenerCount("unhandledRejection");
  const shutdown = createShutdownHandler({
    closeRealtime: (callback) => callback(),
    exitProcess: () => {},
    server: fakeServer({
      close: (callback) => callback(),
      closeIdleConnections: () => {}
    }),
    setShutdownTimeout: () => ({ unref: () => {} })
  });
  const disposeShutdown = registerShutdownHandlers(shutdown);
  const disposeErrors = registerProcessErrorHandlers(shutdown);

  disposeShutdown();
  disposeShutdown();
  disposeErrors();
  disposeErrors();

  assert.equal(process.listenerCount("SIGINT"), sigintBaseline);
  assert.equal(process.listenerCount("unhandledRejection"), rejectionBaseline);
});

test("fatal process errors use the shared idempotent shutdown with failure exit code", async () => {
  const exitCodes: number[] = [];
  let closeApplicationCalls = 0;
  let releaseApplicationDrain = () => {};
  const shutdown = createShutdownHandler({
    closeApplication: () => new Promise<void>((resolve) => {
      closeApplicationCalls += 1;
      releaseApplicationDrain = resolve;
    }),
    closeRealtime: (callback) => callback(),
    exitProcess: (exitCode) => exitCodes.push(exitCode),
    server: fakeServer({
      close: (callback) => callback(),
      closeIdleConnections: () => {}
    }),
    setShutdownTimeout: () => ({ unref: () => {} })
  });
  const handlers = createProcessErrorHandlers(shutdown);

  const gracefulShutdown = shutdown("SIGTERM");
  handlers.onUnhandledRejection(new Error("fatal rejection"));
  handlers.onUncaughtException(new Error("fatal exception"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseApplicationDrain();
  await gracefulShutdown;

  assert.equal(closeApplicationCalls, 1);
  assert.deepEqual(exitCodes, [1]);
});
