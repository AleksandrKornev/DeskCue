import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { LocalRuntimesPanel } from "./LocalRuntimesPanel";
import styles from "./styles.module.scss";

it("keeps long runtime diagnostics visible instead of truncating them", () => {
  const { container } = render(
    <LocalRuntimesPanel
      compact
      isBootstrapping={false}
      isOpen
      isTriggerHidden
      runtimes={[
        {
          endpoint: "http://127.0.0.1:11434",
          id: "ollama",
          installed: true,
          label: "Ollama",
          lastActiveModel: null,
          loadedModelCount: 0,
          modelCount: 0,
          modelStoragePath: "H:\\llm-local\\ollama_data\\models",
          running: false,
          statusText: "installed, API not responding"
        }
      ]}
      onToggleOpen={vi.fn()}
    />
  );

  expect(screen.getByText(/No models reported by this endpoint/)).toHaveClass(
    styles.runtimeMetaWrap
  );

  expect(container.querySelector(`.${styles.runtimeDot}`)).toHaveAttribute(
    "aria-hidden",
    "true"
  );
});
