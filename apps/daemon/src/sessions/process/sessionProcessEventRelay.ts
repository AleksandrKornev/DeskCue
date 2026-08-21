type ChildSubscription = {
  dispose(): void;
};

export class SessionProcessEventRelay {
  private readonly dataHandlers = new Set<(chunk: string) => void>();
  private readonly exitHandlers = new Set<
    (event: { exitCode: number | null }) => void
  >();
  private readonly pendingData: string[] = [];
  private detached = false;
  private exited = false;
  private finalExitCode: number | null = null;

  publishData(value: Buffer | string) {
    if (this.detached) return;

    const text = value.toString();

    if (this.dataHandlers.size === 0) {
      this.pendingData.push(text);
      return;
    }

    for (const handler of this.dataHandlers) {
      handler(text);
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

  onData(handler: (data: string) => void): ChildSubscription {
    this.dataHandlers.add(handler);
    for (const chunk of this.pendingData.splice(0)) {
      handler(chunk);
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
