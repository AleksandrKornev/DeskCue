import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DeskCueLayoutModeProvider,
  useDeskCueLayoutMode
} from ".";

function LayoutModeProbe() {
  return <output aria-label="DeskCue layout mode">{useDeskCueLayoutMode()}</output>;
}

describe("DeskCueLayoutMode", () => {
  it("defaults the standalone app to viewport layout", () => {
    render(<LayoutModeProbe />);

    expect(screen.getByLabelText("DeskCue layout mode")).toHaveTextContent("viewport");
  });

  it("lets an embed own presentation semantics explicitly", () => {
    render(
      <DeskCueLayoutModeProvider mode="embedded">
        <LayoutModeProbe />
      </DeskCueLayoutModeProvider>
    );

    expect(screen.getByLabelText("DeskCue layout mode")).toHaveTextContent("embedded");
  });
});
