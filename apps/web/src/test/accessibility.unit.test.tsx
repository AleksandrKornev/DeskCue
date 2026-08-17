import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { expect, it } from "vitest";

import { Modal } from "@components/Modal";
import { SegmentedTabs } from "@components/SegmentedTabs";

it("keeps the shared tab and dialog primitives free of detectable accessibility violations", async () => {
  const { container } = render(
    <>
      <SegmentedTabs
        activeTab="chat"
        ariaLabel="Session view"
        idPrefix="session-view"
        options={[
          { key: "chat", label: "Chat" },
          { key: "files", label: "Files" }
        ]}
        onSelectTab={() => undefined}
      />
      <section
        aria-labelledby="session-view-tab-chat"
        id="session-view-panel-chat"
        role="tabpanel"
      >
        Chat content
      </section>
      <section
        hidden
        aria-labelledby="session-view-tab-files"
        id="session-view-panel-files"
        role="tabpanel"
      >
        Files content
      </section>
      <Modal
        description="Review the action before continuing."
        isOpen
        title="Confirm action"
        onClose={() => undefined}
      >
        <button type="button">Continue</button>
      </Modal>
    </>
  );

  const dialog = screen.getByRole("dialog", { name: "Confirm action" });
  const pageResults = await axe.run(container);
  const dialogResults = await axe.run(dialog);
  expect([...pageResults.violations, ...dialogResults.violations]).toEqual([]);
});
