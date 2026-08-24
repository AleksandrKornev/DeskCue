type ChildSubscription = {
  dispose(): void;
};

export type ProcessOutputStream = "stdout" | "stderr";

type PendingProcessData = {
  stream: ProcessOutputStream;
  text: string;
};

export class SessionProcessEventRelay {
  private readonly dataHandlers = new Set<
    (chunk: string, stream?: ProcessOutputStream) => void
  >();
  private readonly exitHandlers = new Set<
    (event: { exitCode: number | null }) => void
  >();
  private readonly pendingData: PendingProcessData[] = [];
  private detached = false;
  private exited = false;
  private finalExitCode: number | null = null;

  publishData(value: Buffer | string, stream: ProcessOutputStream = "stdout") {
    if (this.detached) return;

    const text = value.toString();

    if (this.dataHandlers.size === 0) {
      this.pendingData.push({ stream, text });
      return;
    }

    for (const handler of this.dataHandlers) {
      handler(text, stream);
    }
  }

  publishExit(exitCode: number | null) {
    if (this.exited) return;

    this.exited = true;
    this.finalExitCode = exitCode;
    for (const handler of this.exitHandlers) {
      handler({ exitCode });
    }
  }

  detach() {
    this.detached = true;
    this.dataHandlers.clear();
    this.exitHandlers.clear();
    this.pendingData.length = 0;
  }

  onData(
    handler: (data: string, stream?: ProcessOutputStream) => void
  ): ChildSubscription {
    this.dataHandlers.add(handler);
    for (const pending of this.pendingData.splice(0)) {
      handler(pending.text, pending.stream);
    }

    return {
      dispose: () => {
        this.dataHandlers.delete(handler);
      }
    };
  }

  onExit(
    handler: (event: { exitCode: number | null }) => void
  ): ChildSubscription {
    this.exitHandlers.add(handler);
    if (this.exited) handler({ exitCode: this.finalExitCode });

    return {
      dispose: () => {
        this.exitHandlers.delete(handler);
      }
    };
  }
}
