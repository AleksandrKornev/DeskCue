import type { HostControlServer } from "./controlServer.ts";
import type { HostRuntime } from "./hostRuntime.ts";

const HOST_SHUTDOWN_POLL_INTERVAL_MS = 50;

type HostApplicationOptions = {
  exit?: (exitCode: number) => void;
  reportCloseFailure?: (error: unknown) => void;
  shutdownPollIntervalMs?: number;
};

function reportHostCloseFailure(error: unknown) {
  process.stderr.write(`DeskCue Host shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
}

export class HostApplication {
  private closing: Promise<void> | null = null;
  private shutdownPoll: NodeJS.Timeout | null = null;

  constructor(
    private readonly runtime: HostRuntime,
    private readonly controlServer: HostControlServer,
    private readonly options: HostApplicationOptions = {}
  ) {}

  async start() {
    process.once("SIGINT", this.handleSignal);
    process.once("SIGTERM", this.handleSignal);
    this.shutdownPoll = setInterval(
      this.pollShutdownRequest,
      this.options.shutdownPollIntervalMs ?? HOST_SHUTDOWN_POLL_INTERVAL_MS
    );
    this.shutdownPoll.unref?.();
    await this.runtime.startInitialDaemon();
  }

  async abortStart(startError: unknown): Promise<never> {
    const errors = [startError];

    try {
      await this.runtime.close();
    } catch (error) {
      errors.push(error);
    }

    try {
      await this.controlServer.close();
    } catch (error) {
      errors.push(error);
    }

    this.disposeProcessHandlers();
    if (errors.length > 1) throw new AggregateError(errors, "DeskCue Host startup and cleanup failed.");

    throw startError;
  }

  close() {
    if (this.closing) return this.closing;

    const closeAttempt = this.runtime.close()
      .then(() => this.controlServer.close())
      .then(() => this.disposeProcessHandlers());

    this.closing = closeAttempt.catch((error: unknown) => {
      this.closing = null;
      throw error;
    });

    return this.closing;
  }

  private readonly handleSignal = () => {
    void this.close().then(
      () => this.exit(0),
      (error) => this.reportCloseFailure(error)
    );
  };

  private readonly pollShutdownRequest = () => {
    if (this.runtime.status.capabilities["host.shutdown"]?.allowed) return;
    if (this.closing) return;

    void this.close().then(
      () => this.exit(0),
      (error) => this.reportCloseFailure(error)
    );
  };

  private exit(exitCode: number) {
    if (this.options.exit) this.options.exit(exitCode);
    else process.exit(exitCode);
  }

  private reportCloseFailure(error: unknown) {
    (this.options.reportCloseFailure ?? reportHostCloseFailure)(error);
  }

  private disposeProcessHandlers() {
    if (this.shutdownPoll) clearInterval(this.shutdownPoll);
    this.shutdownPoll = null;
    process.off("SIGINT", this.handleSignal);
    process.off("SIGTERM", this.handleSignal);
  }
}
