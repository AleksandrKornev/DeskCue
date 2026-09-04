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

    const Page = this.props.embedded ? "div" : "main";
    const pageClassName = this.props.embedded
      ? `${styles.page} ${styles.embedded}`
      : styles.page;

    return (
      <Page className={pageClassName}>
        <section className={styles.card} role="alert" aria-labelledby="app-error-title">
          <div className={styles.icon} aria-hidden="true">
            !
          </div>
          <p className={styles.eyebrow}>DeskCue couldn&apos;t show this view</p>
          <h1 id="app-error-title">Reload this page to try again</h1>
          <p className={styles.message}>
            A rendering error interrupted this view. Reloading may restore it.
          </p>
          <p className={styles.safetyNote}>
            <span aria-hidden="true" />
            Reloading refreshes only this page. It doesn&apos;t send a stop command to your agents.
          </p>
          <button
            className={styles.reloadButton}
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload DeskCue
          </button>
        </section>
      </Page>
    );
  }
}
