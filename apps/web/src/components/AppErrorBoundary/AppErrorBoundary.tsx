import { Component } from "react";
import type { ErrorInfo } from "react";

import styles from "./styles.module.scss";
import type { AppErrorBoundaryProps, AppErrorBoundaryState } from "./types";

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    failed: false
  };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("DeskCue UI render failed", error, info);
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className={styles.page}>
        <section className={styles.card} role="alert">
          <p className={styles.eyebrow}>DeskCue recovered the page</p>
          <h1>Something changed while this page was open</h1>
          <p>
            Reload DeskCue to reconnect and load a compatible view. Your local sessions keep
            running on the host.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload DeskCue
          </button>
        </section>
      </main>
    );
  }
}
